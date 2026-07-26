"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveSchnellActiveOrder } from "@/lib/client/schnell-active-order";
import {
  bindSchnellPushToOrder,
  prewarmSchnellPush,
  requestSchnellPushPermissionFromGesture,
} from "@/lib/client/schnell-push";

type Extra = {
  id: string;
  name: string;
  label?: string;
  price: number;
};

type Product = {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  category: string;
  categoryLabel: string;
  price: number;
  originalPrice?: number;
  campaignBadge?: string;
  campaignActive?: boolean;
  extras: Extra[];
  allergens: string[];
  allergenHinweise?: string;
};

type Category = { key: string; label: string };

type CartLine = {
  key: string;
  product: Product;
  qty: number;
  extraIds: string[];
  note: string;
};

type CatalogSettings = {
  cashEnabled: boolean;
  onlineEnabled: boolean;
  splitEnabled: boolean;
  takeawayEnabled: boolean;
  orderHistoryEnabled: boolean;
  historyMaxOrders: number;
  historyDays: number;
};

type CatalogResponse = {
  ok?: boolean;
  products?: Product[];
  categories?: Category[];
  settings?: Partial<CatalogSettings>;
  error?: string;
};

type CachedCatalog = {
  savedAt: number;
  products: Product[];
  categories: Category[];
  settings: CatalogSettings;
};

type HistoryItem = {
  productId: string;
  qty: number;
  extraIds: string[];
  note: string;
};

type HistoryEntry = {
  id: string;
  createdAt: number;
  customerNumber: number;
  takeaway: boolean;
  total: number;
  items: HistoryItem[];
};

type AudioWindow = Window &
  typeof globalThis & {
    __bbSchnellReadyAudioContext?: AudioContext;
    __bbSchnellReadyMedia?: HTMLAudioElement;
  };

const DEFAULT_CATALOG_SETTINGS: CatalogSettings = {
  cashEnabled: true,
  onlineEnabled: false,
  splitEnabled: false,
  takeawayEnabled: true,
  orderHistoryEnabled: true,
  historyMaxOrders: 5,
  historyDays: 90,
};

const CATALOG_CACHE_KEY = "bb_schnell_catalog_v5";
const CATALOG_CACHE_MAX_AGE_MS = 30 * 60_000;
const HISTORY_KEY = "bb_schnell_order_history_v1";

const ALLERGEN_LEGEND: Record<string, string> = {
  A: "Glutenhaltiges Getreide",
  A1: "Weizen",
  A2: "Roggen",
  A3: "Gerste",
  A4: "Hafer",
  A5: "Dinkel",
  B: "Krebstiere",
  C: "Eier",
  D: "Fisch",
  E: "Erdnüsse",
  F: "Soja",
  G: "Milch (inkl. Laktose)",
  H: "Schalenfrüchte",
  L: "Sellerie",
  M: "Senf",
  N: "Sesam",
  O: "Schwefeldioxid/Sulfite",
  P: "Lupinen",
  R: "Weichtiere",
};

const euro = (value: number) =>
  value.toLocaleString("de-DE", { style: "currency", currency: "EUR" });

function formatCampaignBadge(value: string) {
  const text = value.trim().replace(/^🔥\s*|\s*🔥$/g, "").trim() || "Angebot";
  return `🔥 ${text.toLocaleUpperCase("de-DE")} 🔥`;
}

function preloadCatalogImages(
  products: Product[],
  category: string,
  limit = 10,
) {
  if (typeof window === "undefined" || !category) return;

  products
    .filter((product) => product.category === category && product.imageUrl)
    .slice(0, limit)
    .forEach((product) => {
      const image = new Image();
      image.decoding = "async";
      image.setAttribute("fetchpriority", "high");
      image.src = product.imageUrl;
    });
}

function CatalogProductImage({
  product,
  index,
}: {
  product: Product;
  index: number;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [product.imageUrl]);

  if (!product.imageUrl || failed) {
    return (
      <div className="grid h-full w-full place-items-center bg-gradient-to-br from-stone-900 to-black px-3 text-center text-xs font-bold text-stone-500">
        Burger Brothers
      </div>
    );
  }

  return (
    <img
      src={product.imageUrl}
      loading={index < 8 ? "eager" : "lazy"}
      decoding={index < 4 ? "sync" : "async"}
      fetchPriority={index < 6 ? "high" : "auto"}
      onError={() => setFailed(true)}
      className="h-full w-full object-contain"
      alt={product.name}
    />
  );
}

function lineTotal(line: CartLine) {
  const extras = line.product.extras
    .filter((extra) => line.extraIds.includes(extra.id))
    .reduce((sum, extra) => sum + extra.price, 0);
  return (line.product.price + extras) * line.qty;
}

function makeLineKey(productId: string, extraIds: string[]) {
  return `${productId}:${[...extraIds].sort().join(",")}:${crypto.randomUUID()}`;
}

function orderFingerprint(cart: CartLine[], takeaway: boolean) {
  return JSON.stringify({
    takeaway,
    items: cart.map((line) => ({
      productId: line.product.id,
      qty: line.qty,
      extraIds: [...line.extraIds].sort(),
      note: line.note.trim(),
    })),
  });
}

function getStableIdempotencyKey(cart: CartLine[], takeaway: boolean) {
  const storageKey = "bb_schnell_pending_order";
  const fingerprint = orderFingerprint(cart, takeaway);

  try {
    const current = JSON.parse(localStorage.getItem(storageKey) || "null") as
      | { key?: string; fingerprint?: string; createdAt?: number }
      | null;
    const fresh =
      current?.key &&
      current.fingerprint === fingerprint &&
      Date.now() - Number(current.createdAt || 0) < 30 * 60_000;

    if (fresh) return current.key as string;
  } catch {
    localStorage.removeItem(storageKey);
  }

  const key = crypto.randomUUID();
  localStorage.setItem(
    storageKey,
    JSON.stringify({ key, fingerprint, createdAt: Date.now() }),
  );
  return key;
}

function normalizeCatalogSettings(value: Partial<CatalogSettings> | undefined) {
  return {
    ...DEFAULT_CATALOG_SETTINGS,
    ...(value || {}),
    historyMaxOrders: Math.max(
      1,
      Math.min(20, Number(value?.historyMaxOrders) || 5),
    ),
    historyDays: Math.max(1, Math.min(365, Number(value?.historyDays) || 90)),
  };
}

function readCachedCatalog(): CachedCatalog | null {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(CATALOG_CACHE_KEY) || "null",
    ) as CachedCatalog | null;

    if (
      !parsed ||
      !Array.isArray(parsed.products) ||
      !Array.isArray(parsed.categories) ||
      Date.now() - Number(parsed.savedAt || 0) > CATALOG_CACHE_MAX_AGE_MS
    ) {
      return null;
    }

    return {
      ...parsed,
      settings: normalizeCatalogSettings(parsed.settings),
    };
  } catch {
    return null;
  }
}

function writeCachedCatalog(
  products: Product[],
  categories: Category[],
  settings: CatalogSettings,
) {
  try {
    window.localStorage.setItem(
      CATALOG_CACHE_KEY,
      JSON.stringify({ savedAt: Date.now(), products, categories, settings }),
    );
  } catch {
    // Optional performance cache.
  }
}

function readHistory(settings: CatalogSettings) {
  if (!settings.orderHistoryEnabled) return [];

  try {
    const history = JSON.parse(
      localStorage.getItem(HISTORY_KEY) || "[]",
    ) as HistoryEntry[];
    const minimumTime = Date.now() - settings.historyDays * 24 * 60 * 60_000;

    return history
      .filter(
        (entry) =>
          entry &&
          Number(entry.createdAt) >= minimumTime &&
          Array.isArray(entry.items),
      )
      .slice(0, settings.historyMaxOrders);
  } catch {
    localStorage.removeItem(HISTORY_KEY);
    return [];
  }
}

function saveHistoryEntry(
  settings: CatalogSettings,
  cart: CartLine[],
  takeaway: boolean,
  customerNumber: number,
  total: number,
) {
  if (!settings.orderHistoryEnabled) return;

  const entry: HistoryEntry = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    customerNumber,
    takeaway,
    total,
    items: cart.map((line) => ({
      productId: line.product.id,
      qty: line.qty,
      extraIds: [...line.extraIds],
      note: line.note,
    })),
  };

  const next = [entry, ...readHistory(settings)].slice(
    0,
    settings.historyMaxOrders,
  );
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
}

function primeReadyAudio() {
  try {
    const audioWindow = window as AudioWindow;
    const AudioContextClass =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

    if (AudioContextClass) {
      const context =
        audioWindow.__bbSchnellReadyAudioContext || new AudioContextClass();
      audioWindow.__bbSchnellReadyAudioContext = context;
      void context.resume();

      const oscillator = context.createOscillator();
      const gain = context.createGain();
      gain.gain.value = 0.00001;
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.03);
    }

    // Aynı kullanıcı dokunuşunda HTML media kanalını da hazırla. Next.js
    // client navigation sırasında window nesnesi korunduğu için başarı ekranı
    // daha sonra aynı audio elementini tekrar kullanabilir.
    const media =
      audioWindow.__bbSchnellReadyMedia ||
      new Audio("/sounds/dine-in.wav");
    media.preload = "auto";
    media.volume = 1;
    media.muted = false;
    media.setAttribute("playsinline", "true");
    audioWindow.__bbSchnellReadyMedia = media;

    const originalVolume = media.volume;
    media.volume = 0.001;
    const prime = media.play();
    if (prime && typeof prime.then === "function") {
      void prime
        .then(() => {
          media.pause();
          media.currentTime = 0;
          media.volume = originalVolume;
        })
        .catch(() => {
          media.volume = originalVolume;
        });
    }

    sessionStorage.setItem("bb_schnell_ready_audio_primed", "1");
  } catch {
    // Sound remains best-effort on mobile browsers.
  }
}

export default function SchnellClient() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [catalogSettings, setCatalogSettings] = useState<CatalogSettings>(
    DEFAULT_CATALOG_SETTINGS,
  );
  const [cart, setCart] = useState<CartLine[]>([]);
  const [category, setCategory] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedExtraIds, setSelectedExtraIds] = useState<string[]>([]);
  const [selectedNote, setSelectedNote] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [takeaway, setTakeaway] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    prewarmSchnellPush();
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("bb_schnell_cart");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setCart(parsed);
      } catch {
        localStorage.removeItem("bb_schnell_cart");
      }
    }

    const cached = readCachedCatalog();
    if (cached?.products.length) {
      const firstCategory =
        cached.categories[0]?.key || cached.products[0]?.category || "";
      preloadCatalogImages(cached.products, firstCategory, 10);
      setProducts(cached.products);
      setCategories(cached.categories);
      setCatalogSettings(cached.settings);
      setHistory(readHistory(cached.settings));
      setCategory(
        cached.categories[0]?.key || cached.products[0]?.category || "",
      );
      setLoading(false);
    }

    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/schnellbestellung/catalog", {
          credentials: "same-origin",
          cache: "default",
        });
        const data = (await response.json().catch(() => ({}))) as CatalogResponse;

        if (cancelled) return;

        if (response.ok && Array.isArray(data.products)) {
          const nextProducts = data.products;
          const nextCategories = Array.isArray(data.categories)
            ? data.categories
            : [];
          const nextSettings = normalizeCatalogSettings(data.settings);
          const firstCategory =
            nextCategories[0]?.key || nextProducts[0]?.category || "";

          preloadCatalogImages(nextProducts, firstCategory, 12);
          setProducts(nextProducts);
          setCategories(nextCategories);
          setCatalogSettings(nextSettings);
          setHistory(readHistory(nextSettings));
          setCategory((current) =>
            nextCategories.some((item) => item.key === current)
              ? current
              : nextCategories[0]?.key || nextProducts[0]?.category || "",
          );
          setError("");
          writeCachedCatalog(nextProducts, nextCategories, nextSettings);
          return;
        }

        if (response.status === 401) {
          setError(
            "Ihre Schnellbestellung-Sitzung ist abgelaufen. Bitte scannen Sie den QR-Code erneut.",
          );
        } else {
          setError("Die Speisekarte ist gerade nicht verfügbar.");
        }
      } catch {
        if (!cancelled && !cached?.products.length) {
          setError("Die Speisekarte ist gerade nicht verfügbar.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("bb_schnell_cart", JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    preloadCatalogImages(products, category, 12);

    const currentIndex = categories.findIndex((item) => item.key === category);
    const nextCategory =
      currentIndex >= 0 ? categories[currentIndex + 1]?.key : categories[0]?.key;
    const timer = nextCategory
      ? window.setTimeout(
          () => preloadCatalogImages(products, nextCategory, 4),
          250,
        )
      : null;

    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [categories, category, products]);

  const visibleProducts = useMemo(
    () => products.filter((product) => product.category === category),
    [category, products],
  );

  const itemCount = cart.reduce((sum, line) => sum + line.qty, 0);
  const total = cart.reduce((sum, line) => sum + lineTotal(line), 0);

  function openProduct(product: Product) {
    setSelectedProduct(product);
    setSelectedExtraIds([]);
    setSelectedNote("");
  }

  function addSelectedProduct() {
    if (!selectedProduct) return;

    setCart((current) => [
      ...current,
      {
        key: makeLineKey(selectedProduct.id, selectedExtraIds),
        product: selectedProduct,
        qty: 1,
        extraIds: selectedExtraIds,
        note: selectedNote.trim().slice(0, 300),
      },
    ]);
    setSelectedProduct(null);
    setSelectedExtraIds([]);
    setSelectedNote("");
  }

  function changeQty(key: string, delta: number) {
    setCart((current) =>
      current
        .map((line) =>
          line.key === key
            ? { ...line, qty: Math.max(0, Math.min(20, line.qty + delta)) }
            : line,
        )
        .filter((line) => line.qty > 0),
    );
  }

  function restoreHistory(entry: HistoryEntry) {
    const productById = new Map(products.map((product) => [product.id, product]));
    const restored: CartLine[] = [];
    let skipped = 0;

    for (const item of entry.items) {
      const product = productById.get(item.productId);
      if (!product) {
        skipped += 1;
        continue;
      }

      const validExtraIds = item.extraIds.filter((extraId) =>
        product.extras.some((extra) => extra.id === extraId),
      );
      restored.push({
        key: makeLineKey(product.id, validExtraIds),
        product,
        qty: Math.max(1, Math.min(20, Number(item.qty) || 1)),
        extraIds: validExtraIds,
        note: String(item.note || "").slice(0, 300),
      });
    }

    if (!restored.length) {
      setError("Die Artikel dieser Bestellung sind momentan nicht verfügbar.");
      return;
    }

    setCart(restored);
    setTakeaway(catalogSettings.takeawayEnabled && entry.takeaway);
    setHistoryOpen(false);
    setCartOpen(true);

    if (skipped > 0) {
      setError("Nicht verfügbare Artikel wurden nicht übernommen.");
    }
  }

  async function placeOrder() {
    if (!cart.length || busy) return;

    setBusy(true);
    setError("");

    try {
      const idempotencyKey = getStableIdempotencyKey(cart, takeaway);
      const response = await fetch("/api/schnellbestellung/orders", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({
          paymentMethod: "cash",
          takeaway: catalogSettings.takeawayEnabled && takeaway,
          items: cart.map((line) => ({
            productId: line.product.id,
            qty: line.qty,
            extraIds: line.extraIds,
            note: line.note,
          })),
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const message =
          data.error === "location_recheck_required"
            ? "Bitte scannen Sie den aktuellen QR-Code erneut."
            : data.error === "DEVICE_RATE_LIMIT"
              ? "Zu viele Bestellungen. Bitte wenden Sie sich an unser Personal."
              : data.error === "PRODUCT_UNAVAILABLE"
                ? "Ein Artikel ist nicht mehr verfügbar."
                : data.error === "SCHNELL_UNAVAILABLE"
                  ? "Schnellbestellung ist momentan pausiert."
                  : "Die Bestellung konnte nicht gesendet werden.";
        throw new Error(message);
      }

      saveHistoryEntry(
        catalogSettings,
        cart,
        catalogSettings.takeawayEnabled && takeaway,
        Number(data.customerNumber || 0),
        Number(data.total || total),
      );

      localStorage.removeItem("bb_schnell_cart");
      localStorage.removeItem("bb_schnell_pending_order");
      setCart([]);
      const createdOrderId = String(data.orderId || "");
      const createdCustomerNumber = Number(data.customerNumber || 0);
      saveSchnellActiveOrder(createdOrderId, createdCustomerNumber);
      void bindSchnellPushToOrder(createdOrderId);
      router.push(
        `/schnellbestellung/success?number=${encodeURIComponent(
          data.customerNumber,
        )}&order=${encodeURIComponent(data.orderId)}`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Die Bestellung konnte nicht gesendet werden.",
      );
      setConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh bg-stone-950 pb-28 text-white">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-stone-950/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <img
            src="/logo-burger-brothers.png"
            className="h-11 w-11 rounded-full"
            alt="Burger Brothers"
          />
          <div className="min-w-0 flex-1">
            <h1 className="font-black">Schnellbestellung</h1>
            <p className="text-xs text-stone-400">Direkt im Restaurant bestellen</p>
          </div>
          {catalogSettings.orderHistoryEnabled && history.length ? (
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="shrink-0 rounded-xl bg-white/10 px-3 py-2 text-xs font-bold"
            >
              Letzte Bestellungen
            </button>
          ) : null}
        </div>

        <div className="mx-auto mt-3 flex max-w-3xl gap-2 overflow-x-auto pb-1">
          {categories.map((item) => (
            <button
              key={item.key}
              type="button"
              onPointerDown={() => preloadCatalogImages(products, item.key, 12)}
              onMouseEnter={() => preloadCatalogImages(products, item.key, 8)}
              onClick={() => setCategory(item.key)}
              className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-bold ${
                category === item.key ? "bg-amber-400 text-black" : "bg-white/10"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <section className="mx-auto grid max-w-3xl grid-cols-2 gap-3 p-3">
        {loading && products.length === 0
          ? Array.from({ length: 6 }, (_, index) => (
              <div
                key={`catalog-skeleton-${index}`}
                className="overflow-hidden rounded-2xl border border-white/10 bg-white/5"
                aria-hidden="true"
              >
                <div className="aspect-[4/3] animate-pulse bg-white/5" />
                <div className="space-y-2 p-3">
                  <div className="h-4 w-3/4 animate-pulse rounded bg-white/10" />
                  <div className="h-3 w-full animate-pulse rounded bg-white/10" />
                  <div className="h-5 w-1/3 animate-pulse rounded bg-white/10" />
                </div>
              </div>
            ))
          : null}

        {!loading && category && visibleProducts.length === 0 ? (
          <div className="col-span-2 rounded-2xl border border-white/10 bg-white/5 p-6 text-center text-stone-300">
            In dieser Kategorie sind momentan keine Artikel verfügbar.
          </div>
        ) : null}

        {visibleProducts.map((product, index) => (
          <button
            key={product.id}
            type="button"
            onClick={() => openProduct(product)}
            className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 text-left"
          >
            {product.campaignBadge ? (
              <span className="absolute right-2 top-2 z-10 animate-pulse rounded-full border border-yellow-200/70 bg-gradient-to-r from-red-600 via-orange-500 to-amber-400 px-2.5 py-1 text-[11px] font-black text-white shadow-[0_0_22px_rgba(251,146,60,0.75)]">
                {formatCampaignBadge(product.campaignBadge)}
              </span>
            ) : null}

            <div className="aspect-[4/3] bg-stone-900">
              <CatalogProductImage product={product} index={index} />
            </div>

            <div className="p-3">
              <h2 className="font-bold leading-tight">{product.name}</h2>
              {product.description ? (
                <p className="mt-1 line-clamp-3 text-xs leading-snug text-stone-400">
                  {product.description}
                </p>
              ) : null}

              {product.allergens.length ? (
                <div className="mt-2 flex flex-wrap gap-1" aria-label="Allergene">
                  {product.allergens.map((allergen) => (
                    <span
                      key={allergen}
                      title={ALLERGEN_LEGEND[allergen] || `Allergen ${allergen}`}
                      className="rounded border border-amber-300/30 bg-amber-300/10 px-1.5 py-0.5 text-[10px] font-black text-amber-200"
                    >
                      {allergen}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="mt-2 flex flex-wrap items-baseline gap-2">
                <span className="font-black text-amber-300">{euro(product.price)}</span>
                {product.originalPrice ? (
                  <span className="text-xs text-stone-500 line-through">
                    {euro(product.originalPrice)}
                  </span>
                ) : null}
              </div>
            </div>
          </button>
        ))}
      </section>

      {error ? (
        <div className="fixed bottom-24 left-4 right-4 z-[80] mx-auto max-w-md rounded-xl bg-red-600 p-3 text-center font-bold shadow-2xl">
          {error}
        </div>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-stone-950 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={() => setCartOpen(true)}
          disabled={!cart.length}
          className="mx-auto flex w-full max-w-3xl items-center justify-between rounded-2xl bg-amber-400 px-5 py-4 font-black text-black disabled:opacity-50"
        >
          <span>{itemCount} Artikel</span>
          <span>Warenkorb · {euro(total)}</span>
        </button>
      </div>

      {selectedProduct ? (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/70"
          onClick={() => setSelectedProduct(null)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="max-h-[88dvh] w-full overflow-y-auto rounded-t-3xl bg-stone-900 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
          >
            <div className="mx-auto max-w-xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-black">{selectedProduct.name}</h2>
                  <div className="mt-1 font-black text-amber-300">
                    {euro(selectedProduct.price)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedProduct(null)}
                  className="rounded-full bg-white/10 px-3 py-2 font-bold"
                  aria-label="Schließen"
                >
                  ✕
                </button>
              </div>

              {selectedProduct.description ? (
                <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs font-black uppercase tracking-wider text-stone-400">
                    Zutaten
                  </div>
                  <p className="mt-2 text-stone-200">{selectedProduct.description}</p>
                </div>
              ) : null}

              {selectedProduct.allergens.length || selectedProduct.allergenHinweise ? (
                <div className="mt-3 rounded-2xl border border-amber-300/25 bg-amber-300/10 p-4">
                  <div className="text-xs font-black uppercase tracking-wider text-amber-200">
                    Allergene
                  </div>
                  {selectedProduct.allergens.length ? (
                    <p className="mt-2 text-sm text-amber-50">
                      {selectedProduct.allergens
                        .map(
                          (allergen) =>
                            `${allergen}${
                              ALLERGEN_LEGEND[allergen]
                                ? ` (${ALLERGEN_LEGEND[allergen]})`
                                : ""
                            }`,
                        )
                        .join(", ")}
                    </p>
                  ) : null}
                  {selectedProduct.allergenHinweise ? (
                    <p className="mt-2 text-sm text-amber-100">
                      {selectedProduct.allergenHinweise}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {selectedProduct.extras?.length ? (
                <div className="mt-5 space-y-2">
                  <div className="text-sm font-black">Extras</div>
                  {selectedProduct.extras.map((extra) => (
                    <label
                      key={extra.id}
                      className="flex items-center justify-between rounded-xl bg-white/5 p-4"
                    >
                      <span>
                        <input
                          type="checkbox"
                          checked={selectedExtraIds.includes(extra.id)}
                          onChange={() =>
                            setSelectedExtraIds((current) =>
                              current.includes(extra.id)
                                ? current.filter((id) => id !== extra.id)
                                : [...current, extra.id],
                            )
                          }
                          className="mr-3"
                        />
                        {extra.name}
                      </span>
                      <b>+ {euro(extra.price)}</b>
                    </label>
                  ))}
                </div>
              ) : null}

              <label className="mt-5 block">
                <span className="text-sm font-black">Hinweis (optional)</span>
                <textarea
                  value={selectedNote}
                  onChange={(event) => setSelectedNote(event.target.value)}
                  maxLength={300}
                  rows={3}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 p-3"
                  placeholder="Zum Beispiel: ohne Zwiebeln"
                />
              </label>

              <button
                type="button"
                onClick={addSelectedProduct}
                className="mt-6 w-full rounded-2xl bg-amber-400 p-4 font-black text-black"
              >
                Zum Warenkorb hinzufügen
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {cartOpen ? (
        <div className="fixed inset-0 z-50 flex items-end bg-black/75">
          <div className="max-h-[90dvh] w-full overflow-y-auto rounded-t-3xl bg-stone-900 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <div className="mx-auto max-w-xl">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-black">Warenkorb</h2>
                <button
                  type="button"
                  onClick={() => setCartOpen(false)}
                  className="rounded-full bg-white/10 px-3 py-2 font-bold"
                >
                  ✕
                </button>
              </div>

              <div className="mt-5 space-y-3">
                {cart.map((line) => (
                  <div
                    key={line.key}
                    className="rounded-2xl border border-white/10 bg-white/5 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-black">{line.product.name}</div>
                        {line.extraIds.length ? (
                          <div className="mt-1 text-xs text-stone-400">
                            Extras: {line.product.extras
                              .filter((extra) => line.extraIds.includes(extra.id))
                              .map((extra) => extra.name)
                              .join(", ")}
                          </div>
                        ) : null}
                        {line.note ? (
                          <div className="mt-1 text-xs text-amber-200">
                            Hinweis: {line.note}
                          </div>
                        ) : null}
                      </div>
                      <div className="font-black text-amber-300">
                        {euro(lineTotal(line))}
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => changeQty(line.key, -1)}
                        className="h-10 w-10 rounded-xl bg-white/10 text-xl font-black"
                      >
                        −
                      </button>
                      <span className="min-w-8 text-center font-black">{line.qty}</span>
                      <button
                        type="button"
                        onClick={() => changeQty(line.key, 1)}
                        className="h-10 w-10 rounded-xl bg-white/10 text-xl font-black"
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {catalogSettings.takeawayEnabled ? (
                <label className="mt-5 flex items-center gap-3 rounded-2xl border border-amber-300/30 bg-amber-300/10 p-4 font-bold">
                  <input
                    type="checkbox"
                    checked={takeaway}
                    onChange={(event) => setTakeaway(event.target.checked)}
                    className="h-5 w-5"
                  />
                  Zum Mitnehmen
                </label>
              ) : null}

              <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4 text-xl font-black">
                <span>Gesamt</span>
                <span>{euro(total)}</span>
              </div>

              <button
                type="button"
                disabled={!cart.length || busy}
                onClick={() => setConfirmOpen(true)}
                className="mt-5 w-full rounded-2xl bg-amber-400 p-4 font-black text-black disabled:opacity-50"
              >
                Bestellung abschließen
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {historyOpen ? (
        <div className="fixed inset-0 z-[60] flex items-end bg-black/75">
          <div className="max-h-[88dvh] w-full overflow-y-auto rounded-t-3xl bg-stone-900 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <div className="mx-auto max-w-xl">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-black">Letzte Bestellungen</h2>
                <button
                  type="button"
                  onClick={() => setHistoryOpen(false)}
                  className="rounded-full bg-white/10 px-3 py-2 font-bold"
                >
                  ✕
                </button>
              </div>

              <div className="mt-5 space-y-3">
                {history.map((entry) => (
                  <article
                    key={entry.id}
                    className="rounded-2xl border border-white/10 bg-white/5 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-black">
                          {new Intl.DateTimeFormat("de-DE", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }).format(new Date(entry.createdAt))}
                        </div>
                        <div className="mt-1 text-sm text-stone-400">
                          {entry.items.reduce((sum, item) => sum + item.qty, 0)} Artikel
                          {entry.takeaway ? " · Zum Mitnehmen" : ""}
                        </div>
                      </div>
                      <div className="font-black text-amber-300">
                        {euro(entry.total)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => restoreHistory(entry)}
                      className="mt-4 w-full rounded-xl bg-amber-400 px-4 py-3 font-black text-black"
                    >
                      In den Warenkorb
                    </button>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {confirmOpen ? (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/80 p-5 backdrop-blur-sm">
          <section className="w-full max-w-md rounded-3xl border border-white/15 bg-stone-900 p-6 text-center shadow-2xl">
            <h2 className="text-2xl font-black">Bestellung abschließen?</h2>
            <p className="mt-3 text-stone-300">
              {catalogSettings.takeawayEnabled && takeaway
                ? "Ihre Bestellung wird zum Mitnehmen aufgegeben. Möchten Sie fortfahren?"
                : "Ihre Bestellung wird zum Verzehr im Restaurant aufgegeben. Möchten Sie fortfahren?"}
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmOpen(false)}
                className="rounded-xl border border-white/15 bg-white/10 p-3 font-bold"
              >
                Zurück
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  primeReadyAudio();
                  requestSchnellPushPermissionFromGesture();
                  void placeOrder();
                }}
                className="rounded-xl bg-emerald-500 p-3 font-black text-black disabled:opacity-50"
              >
                {busy ? "Wird gesendet …" : "Ja, bestellen"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
