"use client";

export type PublicDataKind =
  | "catalog"
  | "groups"
  | "settings"
  | "products";

type CacheEntry = {
  payload: any;
  updatedAt: number;
  status: number;
  statusText: string;
  signature?: string;
};

type RefreshOptions = {
  force?: boolean;
};

const CACHE_VERSION = 4;

const CACHE_KEYS: Record<PublicDataKind, string> = {
  catalog: "bb_public_catalog_cache_v4",
  groups: "bb_public_groups_cache_v3",
  settings: "bb_public_settings_cache_v3",
  products: "bb_public_products_cache_v3",
};

const ENDPOINTS: Record<PublicDataKind, string> = {
  catalog: "/api/catalog",
  groups: "/api/groups",
  settings: "/api/settings",
  products: "/api/products",
};

const FRESH_MS: Record<PublicDataKind, number> = {
  catalog: 60_000,
  groups: 60_000,
  settings: 60_000,
  products: 60_000,
};

const MIN_NETWORK_GAP_MS = 2_000;
const CATEGORY_WARM_TTL_MS = 120_000;

const LEGACY_PRODUCTS_KEY = "bb_products_v1";
const LEGACY_CAMPAIGNS_KEY = "bb_campaigns_v1";
const LEGACY_SETTINGS_KEY = "bb_settings_v6";

const memory = new Map<PublicDataKind, CacheEntry>();
const inflight = new Map<PublicDataKind, Promise<CacheEntry>>();
const lastNetworkAt = new Map<PublicDataKind, number>();
const lastCategoryWarmAt = new Map<string, number>();

let localHydrated = false;
let installed = false;
let nativeFetch: typeof window.fetch | null = null;

const CUSTOMER_DATA_PATHS = new Set([
  "/",
  "/menu",
  "/extras",
  "/drinks",
  "/sauces",
  "/hotdogs",
  "/donuts",
  "/bubble-tea",
]);

function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function isPlainObject(value: any): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function safeStringify(value: any) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return "null";
  }
}

function currentPathAllowsCache() {
  if (!isBrowser()) return false;

  const path = window.location.pathname || "/";

  if (path === "/admin" || path.startsWith("/admin/")) return false;
  if (path === "/checkout" || path.startsWith("/checkout/")) return false;
  if (path === "/tv" || path.startsWith("/tv/")) return false;
  if (path === "/driver" || path.startsWith("/driver/")) return false;

  return CUSTOMER_DATA_PATHS.has(path);
}

function cacheKindForUrl(url: URL): PublicDataKind | null {
  if (url.origin !== window.location.origin) return null;

  if (url.pathname === "/api/catalog") return "catalog";
  if (url.pathname === "/api/groups") return "groups";
  if (url.pathname === "/api/settings") return "settings";
  if (url.pathname === "/api/products") return "products";

  return null;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  const fromInit = String(init?.method || "").trim();
  if (fromInit) return fromInit.toUpperCase();

  if (typeof Request !== "undefined" && input instanceof Request) {
    return String(input.method || "GET").toUpperCase();
  }

  return "GET";
}

function requestUrl(input: RequestInfo | URL) {
  try {
    if (typeof input === "string") {
      return new URL(input, window.location.origin);
    }

    if (input instanceof URL) {
      return new URL(input.toString(), window.location.origin);
    }

    if (typeof Request !== "undefined" && input instanceof Request) {
      return new URL(input.url, window.location.origin);
    }
  } catch {}

  return null;
}

function normalizeSettingsPayload(value: any) {
  if (isPlainObject(value?.settings)) return value.settings;
  if (isPlainObject(value?.data)) return value.data;
  if (!isPlainObject(value)) return {};

  const ignored = new Set([
    "ok",
    "source",
    "tenant",
    "count",
    "counts",
    "saved",
    "keys",
    "error",
    "message",
    "dbError",
    "fallbackSaved",
    "memoryCached",
    "createdAt",
    "updatedAt",
  ]);

  const out: Record<string, any> = {};

  for (const [key, item] of Object.entries(value)) {
    if (ignored.has(key)) continue;
    if (!key || key === "__proto__" || key === "prototype" || key === "constructor") {
      continue;
    }

    out[key] = item;
  }

  return out;
}

function signaturePayload(kind: PublicDataKind, payload: any) {
  if (kind === "settings") {
    return normalizeSettingsPayload(payload);
  }

  if (kind === "catalog") {
    return {
      products: Array.isArray(payload?.products)
        ? payload.products
        : Array.isArray(payload?.items)
          ? payload.items
          : [],
      campaigns: Array.isArray(payload?.campaigns)
        ? payload.campaigns
        : [],
    };
  }

  if (kind === "groups") {
    return {
      extraGroups: Array.isArray(payload?.extraGroups)
        ? payload.extraGroups
        : [],
      drinkGroups: Array.isArray(payload?.drinkGroups)
        ? payload.drinkGroups
        : [],
    };
  }

  return {
    products: Array.isArray(payload?.products)
      ? payload.products
      : Array.isArray(payload?.items)
        ? payload.items
        : [],
  };
}

function signatureOf(kind: PublicDataKind, payload: any) {
  return safeStringify(signaturePayload(kind, payload));
}

function cachedResponse(entry: CacheEntry) {
  return new Response(JSON.stringify(entry.payload ?? {}), {
    status: entry.status || 200,
    statusText: entry.statusText || "OK",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-BB-Client-Cache": "HIT",
    },
  });
}

function legacyEntry(kind: PublicDataKind): CacheEntry | null {
  if (!isBrowser()) return null;

  try {
    if (kind === "catalog") {
      const products = safeJsonParse<any[]>(
        localStorage.getItem(LEGACY_PRODUCTS_KEY),
        [],
      );
      const campaigns = safeJsonParse<any[]>(
        localStorage.getItem(LEGACY_CAMPAIGNS_KEY),
        [],
      );

      if (!products.length && !campaigns.length) return null;

      const payload = {
        ok: true,
        source: "client_cache",
        products,
        items: products,
        campaigns,
      };

      return {
        payload,
        updatedAt: 0,
        status: 200,
        statusText: "OK",
        signature: signatureOf(kind, payload),
      };
    }

    if (kind === "products") {
      const products = safeJsonParse<any[]>(
        localStorage.getItem(LEGACY_PRODUCTS_KEY),
        [],
      );

      if (!products.length) return null;

      const payload = {
        ok: true,
        source: "client_cache",
        products,
        items: products,
      };

      return {
        payload,
        updatedAt: 0,
        status: 200,
        statusText: "OK",
        signature: signatureOf(kind, payload),
      };
    }

    if (kind === "settings") {
      const settings = safeJsonParse<Record<string, any>>(
        localStorage.getItem(LEGACY_SETTINGS_KEY),
        {},
      );

      if (!Object.keys(settings).length) return null;

      const payload = {
        ok: true,
        source: "client_cache",
        ...settings,
      };

      return {
        payload,
        updatedAt: 0,
        status: 200,
        statusText: "OK",
        signature: signatureOf(kind, payload),
      };
    }
  } catch {}

  return null;
}

function hydrateLocalCache() {
  if (!isBrowser() || localHydrated) return;

  localHydrated = true;

  for (const kind of Object.keys(CACHE_KEYS) as PublicDataKind[]) {
    try {
      const saved = safeJsonParse<CacheEntry | null>(
        localStorage.getItem(CACHE_KEYS[kind]),
        null,
      );

      if (
        saved &&
        isPlainObject(saved) &&
        "payload" in saved &&
        Number.isFinite(Number(saved.updatedAt))
      ) {
        memory.set(kind, {
          payload: saved.payload,
          updatedAt: Number(saved.updatedAt) || 0,
          status: Number(saved.status) || 200,
          statusText: String(saved.statusText || "OK"),
          signature:
            String(saved.signature || "") ||
            signatureOf(kind, saved.payload),
        });
        continue;
      }
    } catch {}

    const legacy = legacyEntry(kind);
    if (legacy) memory.set(kind, legacy);
  }
}

function writeLocalIfChanged(key: string, value: any) {
  if (!isBrowser()) return false;

  const next = safeStringify(value);
  const previous = localStorage.getItem(key);

  if (previous === next) return false;

  localStorage.setItem(key, next);
  return true;
}

/*
 * Aynı payload tekrar gelirse sadece updatedAt yenilenir.
 * Ürün listesi ve resimler yeniden yayınlanmaz.
 */
function commitEntry(kind: PublicDataKind, input: CacheEntry) {
  hydrateLocalCache();

  const signature = input.signature || signatureOf(kind, input.payload);
  const previous = memory.get(kind) || null;
  const changed = !previous || previous.signature !== signature;

  const entry: CacheEntry = {
    ...input,
    signature,
  };

  memory.set(kind, entry);

  if (isBrowser()) {
    try {
      localStorage.setItem(CACHE_KEYS[kind], safeStringify(entry));
    } catch {}

    if (changed) {
      try {
        if (kind === "catalog") {
          const products = Array.isArray(entry.payload?.products)
            ? entry.payload.products
            : Array.isArray(entry.payload?.items)
              ? entry.payload.items
              : [];

          const campaigns = Array.isArray(entry.payload?.campaigns)
            ? entry.payload.campaigns
            : [];

          writeLocalIfChanged(LEGACY_PRODUCTS_KEY, products);
          writeLocalIfChanged(LEGACY_CAMPAIGNS_KEY, campaigns);
        }

        if (kind === "products") {
          const products = Array.isArray(entry.payload?.products)
            ? entry.payload.products
            : Array.isArray(entry.payload?.items)
              ? entry.payload.items
              : [];

          if (products.length) {
            writeLocalIfChanged(LEGACY_PRODUCTS_KEY, products);
          }
        }

        if (kind === "settings") {
          const settings = normalizeSettingsPayload(entry.payload);

          if (Object.keys(settings).length) {
            writeLocalIfChanged(LEGACY_SETTINGS_KEY, settings);
          }
        }
      } catch {}
    }
  }

  return { entry, changed };
}

/*
 * Same-tab sahte StorageEvent kaldırıldı.
 * Eski sürümde event tekrar cache invalidation başlatıp ping döngüsü yaratıyordu.
 */
function notifyUpdated(kind: PublicDataKind, payload: any) {
  if (!isBrowser()) return;

  try {
    window.dispatchEvent(
      new CustomEvent("bb:public-data-updated", {
        detail: { kind, payload },
      }),
    );
  } catch {}

  if (kind === "catalog" || kind === "products") {
    try {
      window.dispatchEvent(
        new CustomEvent("bb:catalog-sync", {
          detail: payload,
        }),
      );
    } catch {}
  }

  if (kind === "groups") {
    try {
      window.dispatchEvent(
        new CustomEvent("bb:groups-sync", {
          detail: payload,
        }),
      );
    } catch {}
  }

  if (kind === "settings") {
    try {
      window.dispatchEvent(
        new CustomEvent("bb_settings_changed", {
          detail: normalizeSettingsPayload(payload),
        }),
      );
    } catch {}
  }
}

function getEntry(kind: PublicDataKind) {
  hydrateLocalCache();
  return memory.get(kind) || null;
}

function isFresh(kind: PublicDataKind, entry: CacheEntry | null) {
  if (!entry) return false;
  return Date.now() - entry.updatedAt <= FRESH_MS[kind];
}

async function networkRequest(kind: PublicDataKind): Promise<CacheEntry> {
  if (!isBrowser()) {
    throw new Error("PUBLIC_DATA_BROWSER_ONLY");
  }

  const existing = inflight.get(kind);
  if (existing) return existing;

  const request = (async () => {
    lastNetworkAt.set(kind, Date.now());

    const fetcher =
      nativeFetch ||
      ((window as any).__bbNativePublicFetch as
        | typeof window.fetch
        | undefined) ||
      window.fetch.bind(window);

    const response = await fetcher(ENDPOINTS[kind], {
      method: "GET",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "x-bb-client-cache-bypass": "1",
      },
    });

    const payload = await response.json().catch(() => ({}));

    const entry: CacheEntry = {
      payload,
      updatedAt: Date.now(),
      status: response.status,
      statusText: response.statusText || (response.ok ? "OK" : "Error"),
      signature: signatureOf(kind, payload),
    };

    if (response.ok && payload?.ok !== false) {
      const committed = commitEntry(kind, entry);

      if (committed.changed) {
        notifyUpdated(kind, payload);
      }

      return committed.entry;
    }

    return entry;
  })();

  inflight.set(kind, request);

  try {
    return await request;
  } finally {
    inflight.delete(kind);
  }
}

export async function refreshPublicData(
  kind: PublicDataKind,
  options: RefreshOptions = {},
) {
  const cached = getEntry(kind);

  if (!options.force && isFresh(kind, cached)) {
    return cached;
  }

  const last = lastNetworkAt.get(kind) || 0;

  if (
    cached &&
    Date.now() - last < MIN_NETWORK_GAP_MS &&
    !inflight.has(kind)
  ) {
    return cached;
  }

  try {
    const fresh = await networkRequest(kind);

    if (
      fresh.status >= 200 &&
      fresh.status < 300 &&
      fresh.payload?.ok !== false
    ) {
      return fresh;
    }

    return cached || fresh;
  } catch {
    return cached;
  }
}

export async function warmPublicData(
  kinds: PublicDataKind[] = ["catalog", "groups", "settings"],
  options: RefreshOptions = {},
) {
  if (!isBrowser()) return [];

  return Promise.all(
    Array.from(new Set(kinds)).map((kind) =>
      refreshPublicData(kind, options),
    ),
  );
}

export function invalidatePublicData(kind: PublicDataKind) {
  hydrateLocalCache();

  const current = memory.get(kind);
  if (!current) return;

  memory.set(kind, {
    ...current,
    updatedAt: 0,
  });
}

export function seedPublicData(kind: PublicDataKind, payload: any) {
  if (!isBrowser() || payload == null) return;

  const normalized =
    kind === "settings"
      ? {
          ok: true,
          source: "event",
          ...normalizeSettingsPayload(payload),
        }
      : payload;

  commitEntry(kind, {
    payload: normalized,
    updatedAt: Date.now(),
    status: 200,
    statusText: "OK",
    signature: signatureOf(kind, normalized),
  });
}

function normalizeCategory(value: any) {
  const text = String(value || "")
    .trim()
    .toLowerCase();

  if (text.includes("vegan") || text.includes("vegetar")) return "vegan";
  if (
    text.includes("drink") ||
    text.includes("getränk") ||
    text.includes("getraenk")
  ) {
    return "drinks";
  }
  if (
    text.includes("sauce") ||
    text.includes("soß") ||
    text.includes("sos")
  ) {
    return "sauces";
  }
  if (text.includes("hotdog") || text.includes("hot dog")) return "hotdogs";
  if (text.includes("donut") || text.includes("doughnut")) return "donuts";
  if (text.includes("bubble") || text.includes("boba")) return "bubbletea";
  if (
    text.includes("extra") ||
    text.includes("pommes") ||
    text.includes("fries")
  ) {
    return "extras";
  }

  return "burger";
}

function imageUrlOf(value: any) {
  const url = String(
    value?.imageUrl ??
      value?.image ??
      value?.cover ??
      value?.photoUrl ??
      "",
  ).trim();

  if (!url || url.includes("...")) return "";
  return url;
}

function preloadUrls(urls: string[], limit = 10) {
  if (!isBrowser()) return;

  const unique = Array.from(new Set(urls.filter(Boolean))).slice(0, limit);

  for (const url of unique) {
    try {
      const image = new Image();
      image.decoding = "async";
      (image as any).fetchPriority = "low";
      image.src = url;
    } catch {}
  }
}

export async function warmCategoryData(categoryInput: string) {
  const category = normalizeCategory(categoryInput);
  const last = lastCategoryWarmAt.get(category) || 0;

  if (Date.now() - last < CATEGORY_WARM_TTL_MS) return;

  lastCategoryWarmAt.set(category, Date.now());

  await warmPublicData(
    category === "extras" || category === "drinks"
      ? ["catalog", "groups", "settings"]
      : ["catalog", "settings"],
  );

  const catalog = getEntry("catalog")?.payload || {};
  const groups = getEntry("groups")?.payload || {};

  const products = Array.isArray(catalog?.products)
    ? catalog.products
    : Array.isArray(catalog?.items)
      ? catalog.items
      : [];

  const productUrls = products
    .filter(
      (product: any) =>
        normalizeCategory(product?.category) === category,
    )
    .map(imageUrlOf)
    .filter(Boolean);

  let groupUrls: string[] = [];

  if (category === "extras") {
    const list = Array.isArray(groups?.extraGroups)
      ? groups.extraGroups
      : [];

    groupUrls = list.flatMap((group: any) => [
      imageUrlOf(group),
      ...(Array.isArray(group?.variants)
        ? group.variants.map(imageUrlOf)
        : []),
    ]);
  }

  if (category === "drinks") {
    const list = Array.isArray(groups?.drinkGroups)
      ? groups.drinkGroups
      : [];

    groupUrls = list.flatMap((group: any) => [
      imageUrlOf(group),
      ...(Array.isArray(group?.variants)
        ? group.variants.map(imageUrlOf)
        : []),
    ]);
  }

  preloadUrls(
    [...productUrls, ...groupUrls],
    category === "burger" ? 12 : 8,
  );
}

export function installPublicDataFetchCache() {
  if (!isBrowser()) return;

  hydrateLocalCache();

  const globalWindow = window as any;

  if (globalWindow.__bbPublicFetchVersion === CACHE_VERSION) {
    installed = true;
    nativeFetch =
      globalWindow.__bbNativePublicFetch ||
      window.fetch.bind(window);
    return;
  }

  nativeFetch =
    globalWindow.__bbNativePublicFetch ||
    window.fetch.bind(window);

  globalWindow.__bbNativePublicFetch = nativeFetch;

  const wrappedFetch: typeof window.fetch = async (input, init) => {
    if (
      !currentPathAllowsCache() ||
      requestMethod(input, init) !== "GET" ||
      String(
        typeof Request !== "undefined" && input instanceof Request
          ? input.headers.get("x-bb-client-cache-bypass") || ""
          : new Headers(init?.headers).get(
              "x-bb-client-cache-bypass",
            ) || "",
      ) === "1"
    ) {
      return nativeFetch!(input, init);
    }

    const url = requestUrl(input);
    const kind = url ? cacheKindForUrl(url) : null;

    if (!kind) {
      return nativeFetch!(input, init);
    }

    const cached = getEntry(kind);

    if (cached) {
      if (!isFresh(kind, cached)) {
        void refreshPublicData(kind);
      }

      return cachedResponse(cached);
    }

    try {
      const fresh = await networkRequest(kind);
      return cachedResponse(fresh);
    } catch {
      return nativeFetch!(input, init);
    }
  };

  window.fetch = wrappedFetch;
  globalWindow.__bbPublicFetchInstalled = true;
  globalWindow.__bbPublicFetchVersion = CACHE_VERSION;
  installed = true;
}

export function isPublicDataFetchCacheInstalled() {
  return installed;
}
