"use client";

import { useEffect, useMemo, useState } from "react";

type CatalogExtra = {
  id?: string;
  sku?: string;
  name?: string;
  label?: string;
  price?: number | string;
};

type CatalogProduct = {
  id?: string;
  sku?: string;
  code?: string;
  name?: string;
  category?: string;
  categoryKey?: string;
  price?: number | string;
  active?: boolean;
  activeFrom?: string | null;
  activeTo?: string | null;
  extras?: CatalogExtra[];
  extrasJson?: CatalogExtra[];
};

type RegisterProduct = {
  key: string;
  name: string;
  category: string;
  price: number;
  source: "product" | "embedded-extra";
};

type CatalogResponse = {
  ok?: boolean;
  products?: CatalogProduct[];
  items?: CatalogProduct[];
  error?: string;
};

type GroupKey = "burgers" | "vegetarian" | "extras" | "drinks";

type Group = {
  key: GroupKey;
  label: string;
};

const GROUPS: Group[] = [
  { key: "burgers", label: "Burger" },
  { key: "vegetarian", label: "Vegetarian" },
  { key: "extras", label: "Ekstralar" },
  { key: "drinks", label: "İçecekler" },
];

const euro = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

function toPrice(value: number | string | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? "").replace(/[€\s]/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeText(value: string) {
  return value
    .toLocaleLowerCase("de-DE")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function cleanName(value: string) {
  return value
    .replace(/[\uFFFD\u25C6\u25C7\u25CA\u25A0\u25A1]/g, " ")
    .replace(/[\u2600-\u27BF]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function productIsCurrent(product: CatalogProduct) {
  if (product.active === false) return false;
  const now = Date.now();

  if (product.activeFrom) {
    const start = new Date(product.activeFrom).getTime();
    if (Number.isFinite(start) && start > now) return false;
  }

  if (product.activeTo) {
    const end = new Date(product.activeTo).getTime();
    if (Number.isFinite(end) && end < now) return false;
  }

  return true;
}

function isVegetarianCategory(category: string) {
  const value = normalizeText(category);
  return value === "vegan" || value === "vegetarian" || value === "vegetarisch" || value === "veggie";
}

function groupFor(item: RegisterProduct): GroupKey | null {
  const category = normalizeText(item.category);

  if (category === "burger") return "burgers";
  if (isVegetarianCategory(category)) return "vegetarian";
  if (category === "drinks" || category === "drink" || category === "getranke") return "drinks";

  if (
    item.source === "embedded-extra" ||
    category === "extras" ||
    category === "extra" ||
    category === "sauces" ||
    category === "sauce" ||
    category === "sossen"
  ) {
    return "extras";
  }

  return null;
}

function canonicalProduct(product: CatalogProduct, index: number): RegisterProduct | null {
  const name = cleanName(String(product.name ?? ""));
  const price = toPrice(product.price);
  const category = String(product.categoryKey ?? product.category ?? "other").trim().toLowerCase();

  if (!name || price < 0) return null;

  return {
    key: `product:${String(product.id ?? product.sku ?? product.code ?? `${category}:${name}:${index}`)}`,
    name,
    category,
    price,
    source: "product",
  };
}

function collectEmbeddedExtras(products: CatalogProduct[]) {
  const unique = new Map<string, RegisterProduct>();

  for (const product of products) {
    const extras = Array.isArray(product.extras)
      ? product.extras
      : Array.isArray(product.extrasJson)
        ? product.extrasJson
        : [];

    for (const extra of extras) {
      const name = cleanName(String(extra.name ?? extra.label ?? ""));
      const price = toPrice(extra.price);
      if (!name || price <= 0) continue;

      const fingerprint = `${normalizeText(name)}:${price.toFixed(2)}`;
      if (unique.has(fingerprint)) continue;

      unique.set(fingerprint, {
        key: `extra:${String(extra.id ?? extra.sku ?? fingerprint)}`,
        name,
        category: "extras",
        price,
        source: "embedded-extra",
      });
    }
  }

  return Array.from(unique.values());
}

export default function MobileRegisterPage() {
  const [products, setProducts] = useState<RegisterProduct[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [activeGroup, setActiveGroup] = useState<GroupKey>("burgers");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = oldOverflow;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadCatalog() {
      try {
        setLoading(true);
        setError("");

        const response = await fetch("/api/catalog", { cache: "no-store" });
        const data = (await response.json().catch(() => ({}))) as CatalogResponse;

        if (!response.ok || data.ok === false) {
          throw new Error(data.error || "catalog_load_failed");
        }

        const rawProducts = (Array.isArray(data.products) ? data.products : data.items || []).filter(
          productIsCurrent,
        );

        const mainProducts = rawProducts
          .map(canonicalProduct)
          .filter((item): item is RegisterProduct => Boolean(item));

        const embeddedExtras = collectEmbeddedExtras(rawProducts);
        const allowed = [...mainProducts, ...embeddedExtras]
          .filter((item) => groupFor(item) !== null)
          .sort((a, b) => a.name.localeCompare(b.name, "de-DE", { sensitivity: "base" }));

        if (!cancelled) setProducts(allowed);
      } catch (catalogError) {
        console.error("Kasa catalog load failed", catalogError);
        if (!cancelled) setError("Ürünler şu anda yüklenemedi. Tekrar deneyin.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadCatalog();
    return () => {
      cancelled = true;
    };
  }, []);

  const productByKey = useMemo(
    () => new Map(products.map((product) => [product.key, product])),
    [products],
  );

  const countsByGroup = useMemo(() => {
    const counts: Record<GroupKey, number> = {
      burgers: 0,
      vegetarian: 0,
      extras: 0,
      drinks: 0,
    };

    for (const product of products) {
      const group = groupFor(product);
      if (group) counts[group] += 1;
    }

    return counts;
  }, [products]);

  const filteredProducts = useMemo(() => {
    const query = normalizeText(search);

    return products.filter((product) => {
      const matchesGroup = groupFor(product) === activeGroup;
      const matchesSearch = !query || normalizeText(product.name).includes(query);
      return matchesGroup && matchesSearch;
    });
  }, [activeGroup, products, search]);

  const cartItems = useMemo(() => {
    return Object.entries(cart)
      .map(([key, quantity]) => {
        const product = productByKey.get(key);
        return product && quantity > 0 ? { product, quantity } : null;
      })
      .filter(
        (item): item is { product: RegisterProduct; quantity: number } => Boolean(item),
      );
  }, [cart, productByKey]);

  const totalQuantity = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.quantity, 0),
    [cartItems],
  );

  const total = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.product.price * item.quantity, 0),
    [cartItems],
  );

  function changeQuantity(key: string, delta: number) {
    setCart((current) => {
      const nextQuantity = Math.max(0, (current[key] || 0) + delta);
      const next = { ...current };
      if (nextQuantity === 0) delete next[key];
      else next[key] = nextQuantity;
      return next;
    });
  }

  function clearCart() {
    setCart({});
  }

  return (
    <div id="bb-kasa-page" className="bb-register-page">
      <style jsx global>{`
        body:has(#bb-kasa-page) .bb-mobile-footer-gap,
        body:has(#bb-kasa-page) footer {
          display: none !important;
        }

        .bb-register-page,
        .bb-register-page * {
          box-sizing: border-box;
        }

        .bb-register-page *::before,
        .bb-register-page *::after {
          content: none !important;
        }

        .bb-register-page button,
        .bb-register-page input {
          font: inherit;
        }

        .bb-register-page button {
          -webkit-tap-highlight-color: transparent;
          touch-action: manipulation;
        }
      `}</style>

      <header className="bb-register-header">
        <div>
          <p className="bb-register-kicker">BURGER BROTHERS</p>
          <h1>Fiyat Kasası</h1>
        </div>
        <div className="bb-register-status">Hızlı hesap</div>
      </header>

      <div className="bb-register-search-wrap">
        <input
          aria-label="Ürün ara"
          className="bb-register-search"
          placeholder="Ürün ara…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <nav className="bb-register-tabs" aria-label="Ürün kategorileri">
        {GROUPS.map((group) => (
          <button
            key={group.key}
            type="button"
            className={activeGroup === group.key ? "is-active" : ""}
            onClick={() => {
              setActiveGroup(group.key);
              setSearch("");
            }}
          >
            <span>{group.label}</span>
            <small>{countsByGroup[group.key]}</small>
          </button>
        ))}
      </nav>

      <main className="bb-register-content">
        {loading ? (
          <div className="bb-register-state">Ürünler yükleniyor…</div>
        ) : error ? (
          <div className="bb-register-state is-error">{error}</div>
        ) : filteredProducts.length === 0 ? (
          <div className="bb-register-state">Bu bölümde ürün bulunamadı.</div>
        ) : (
          <div className="bb-register-grid">
            {filteredProducts.map((product) => {
              const quantity = cart[product.key] || 0;

              return (
                <button
                  key={product.key}
                  type="button"
                  className={`bb-product-button${quantity ? " is-selected" : ""}`}
                  onClick={() => changeQuantity(product.key, 1)}
                >
                  {quantity > 0 && <span className="bb-product-count">{quantity}</span>}
                  <span className="bb-product-name">{product.name}</span>
                  <strong>{euro.format(product.price)}</strong>
                </button>
              );
            })}
          </div>
        )}

        <section className="bb-cart-panel" aria-label="Hesap">
          <div className="bb-cart-heading">
            <div>
              <span>HESAP</span>
              <strong>{totalQuantity} ürün</strong>
            </div>
            {cartItems.length > 0 && (
              <button type="button" onClick={clearCart}>
                Temizle
              </button>
            )}
          </div>

          {cartItems.length === 0 ? (
            <div className="bb-cart-empty">Ürüne dokun, hesaba eklensin.</div>
          ) : (
            <div className="bb-cart-lines">
              {cartItems.map(({ product, quantity }) => (
                <div className="bb-cart-line" key={product.key}>
                  <div className="bb-cart-line-main">
                    <span>{product.name}</span>
                    <strong>{euro.format(product.price * quantity)}</strong>
                  </div>
                  <div className="bb-quantity-control" aria-label={`${product.name} adet`}>
                    <button
                      type="button"
                      aria-label={`${product.name} azalt`}
                      onClick={() => changeQuantity(product.key, -1)}
                    >
                      −
                    </button>
                    <span>{quantity}</span>
                    <button
                      type="button"
                      aria-label={`${product.name} artır`}
                      onClick={() => changeQuantity(product.key, 1)}
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <div className="bb-register-bottom">
        <div className="bb-register-total">
          <span>TOPLAM</span>
          <strong>{euro.format(total)}</strong>
        </div>
        <button type="button" className="bb-new-order" onClick={clearCart} disabled={!cartItems.length}>
          Yeni Hesap
        </button>
      </div>

      <style jsx>{`
        .bb-register-page {
          position: fixed;
          inset: 0;
          z-index: 100000;
          display: flex;
          flex-direction: column;
          width: 100%;
          min-width: 0;
          height: 100dvh;
          color: #f7f7f7;
          background: #090909;
          overflow: hidden;
          overscroll-behavior: none;
        }

        .bb-register-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: calc(env(safe-area-inset-top) + 12px) 14px 11px;
          border-bottom: 1px solid #242424;
          background: #101010;
        }

        .bb-register-kicker {
          margin: 0 0 3px;
          color: #858585;
          font-size: 10px;
          font-weight: 850;
          letter-spacing: 0.17em;
        }

        .bb-register-header h1 {
          margin: 0;
          font-size: clamp(22px, 6vw, 29px);
          line-height: 1;
          font-weight: 950;
          letter-spacing: -0.04em;
        }

        .bb-register-status {
          flex: 0 0 auto;
          padding: 7px 10px;
          border: 1px solid #343434;
          border-radius: 999px;
          color: #aaa;
          background: #181818;
          font-size: 10px;
          font-weight: 800;
          white-space: nowrap;
        }

        .bb-register-search-wrap {
          padding: 9px 10px 8px;
          background: #090909;
        }

        .bb-register-search {
          width: 100%;
          height: 43px;
          padding: 0 13px;
          border: 1px solid #2b2b2b;
          border-radius: 12px;
          outline: none;
          color: #fff;
          background: #151515;
          font-size: 16px;
          appearance: none;
        }

        .bb-register-search:focus {
          border-color: #777;
          background: #191919;
        }

        .bb-register-tabs {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 5px;
          padding: 0 10px 9px;
          background: #090909;
        }

        .bb-register-tabs button {
          position: relative;
          min-width: 0;
          min-height: 46px;
          padding: 7px 4px;
          border: 1px solid #2c2c2c;
          border-radius: 10px;
          color: #aaa;
          background: #151515;
          font-weight: 850;
          cursor: pointer;
          overflow: hidden;
        }

        .bb-register-tabs button.is-active {
          border-color: #f3f3f3;
          color: #090909;
          background: #f3f3f3;
        }

        .bb-register-tabs span {
          display: block;
          overflow: hidden;
          font-size: clamp(9px, 2.8vw, 12px);
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .bb-register-tabs small {
          position: absolute;
          top: 2px;
          right: 4px;
          color: #6f6f6f;
          font-size: 7px;
          font-weight: 900;
        }

        .bb-register-content {
          flex: 1 1 auto;
          min-height: 0;
          overflow-y: auto;
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
          padding: 0 10px 122px;
        }

        .bb-register-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 7px;
          width: 100%;
        }

        .bb-product-button {
          position: relative;
          display: flex;
          min-width: 0;
          min-height: 78px;
          flex-direction: column;
          align-items: flex-start;
          justify-content: space-between;
          gap: 8px;
          padding: 11px 10px;
          border: 1px solid #2c2c2c;
          border-radius: 12px;
          color: #f3f3f3;
          background: #171717;
          text-align: left;
          cursor: pointer;
          user-select: none;
        }

        .bb-product-button:active {
          transform: scale(0.98);
          background: #232323;
        }

        .bb-product-button.is-selected {
          border-color: #d6d6d6;
          background: #202020;
        }

        .bb-product-name {
          display: -webkit-box;
          width: calc(100% - 20px);
          overflow: hidden;
          color: #f5f5f5;
          font-size: 13px;
          font-weight: 850;
          line-height: 1.16;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
        }

        .bb-product-button strong {
          color: #bdbdbd;
          font-size: 13px;
          font-weight: 850;
          font-variant-numeric: tabular-nums;
        }

        .bb-product-count {
          position: absolute;
          top: 7px;
          right: 7px;
          display: grid;
          width: 22px;
          height: 22px;
          place-items: center;
          border-radius: 999px;
          color: #0b0b0b;
          background: #fff;
          font-size: 11px;
          font-weight: 950;
        }

        .bb-register-state {
          display: grid;
          min-height: 160px;
          place-items: center;
          padding: 24px;
          color: #8e8e8e;
          font-size: 13px;
          text-align: center;
        }

        .bb-register-state.is-error {
          color: #ffb4b4;
        }

        .bb-cart-panel {
          margin-top: 12px;
          border: 1px solid #292929;
          border-radius: 14px;
          overflow: hidden;
          background: #121212;
        }

        .bb-cart-heading {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          min-height: 51px;
          padding: 9px 11px;
          border-bottom: 1px solid #252525;
        }

        .bb-cart-heading > div {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .bb-cart-heading span {
          color: #777;
          font-size: 9px;
          font-weight: 900;
          letter-spacing: 0.14em;
        }

        .bb-cart-heading strong {
          color: #e5e5e5;
          font-size: 12px;
        }

        .bb-cart-heading button {
          min-height: 32px;
          padding: 0 10px;
          border: 1px solid #3b3b3b;
          border-radius: 9px;
          color: #bdbdbd;
          background: #1d1d1d;
          font-size: 11px;
          font-weight: 800;
        }

        .bb-cart-empty {
          padding: 20px 12px;
          color: #777;
          font-size: 12px;
          text-align: center;
        }

        .bb-cart-lines {
          padding: 3px 10px;
        }

        .bb-cart-line {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 9px 0;
          border-bottom: 1px solid #222;
        }

        .bb-cart-line:last-child {
          border-bottom: 0;
        }

        .bb-cart-line-main {
          display: flex;
          min-width: 0;
          flex: 1;
          flex-direction: column;
          gap: 2px;
        }

        .bb-cart-line-main span {
          overflow: hidden;
          color: #e8e8e8;
          font-size: 12px;
          font-weight: 750;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .bb-cart-line-main strong {
          color: #929292;
          font-size: 11px;
          font-variant-numeric: tabular-nums;
        }

        .bb-quantity-control {
          display: grid;
          flex: 0 0 auto;
          grid-template-columns: 34px 28px 34px;
          align-items: center;
          overflow: hidden;
          border: 1px solid #333;
          border-radius: 10px;
          background: #1a1a1a;
        }

        .bb-quantity-control button {
          width: 34px;
          height: 34px;
          border: 0;
          color: #fff;
          background: transparent;
          font-size: 20px;
          font-weight: 500;
        }

        .bb-quantity-control span {
          color: #ddd;
          font-size: 12px;
          font-weight: 900;
          text-align: center;
          font-variant-numeric: tabular-nums;
        }

        .bb-register-bottom {
          position: absolute;
          right: 0;
          bottom: 0;
          left: 0;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 9px;
          align-items: stretch;
          padding: 10px 10px calc(env(safe-area-inset-bottom) + 10px);
          border-top: 1px solid #2a2a2a;
          background: rgba(11, 11, 11, 0.97);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
        }

        .bb-register-total {
          display: flex;
          min-width: 0;
          flex-direction: column;
          justify-content: center;
          padding: 3px 4px;
        }

        .bb-register-total span {
          color: #858585;
          font-size: 9px;
          font-weight: 900;
          letter-spacing: 0.16em;
        }

        .bb-register-total strong {
          overflow: hidden;
          color: #fff;
          font-size: clamp(24px, 8vw, 34px);
          font-weight: 950;
          line-height: 1.05;
          letter-spacing: -0.04em;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }

        .bb-new-order {
          min-width: 105px;
          min-height: 54px;
          padding: 0 15px;
          border: 0;
          border-radius: 13px;
          color: #050505;
          background: #f5f5f5;
          font-size: 12px;
          font-weight: 900;
        }

        .bb-new-order:disabled {
          color: #666;
          background: #252525;
        }

        @media (max-width: 380px) {
          .bb-register-tabs span {
            font-size: 9px;
          }

          .bb-register-tabs button {
            padding-inline: 2px;
          }
        }

        @media (min-width: 560px) {
          .bb-register-page {
            left: 50%;
            right: auto;
            width: min(100%, 560px);
            transform: translateX(-50%);
            border-right: 1px solid #282828;
            border-left: 1px solid #282828;
            box-shadow: 0 0 80px rgba(0, 0, 0, 0.5);
          }

          :global(body) {
            background: #050505 !important;
          }
        }
      `}</style>
    </div>
  );
}
