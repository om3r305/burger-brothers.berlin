"use client";

export type PublicDataKind = "catalog" | "groups" | "settings" | "products";

type CacheEntry = {
  payload: any;
  updatedAt: number;
  status: number;
  statusText: string;
};

type RefreshOptions = {
  force?: boolean;
};

const CACHE_KEYS: Record<PublicDataKind, string> = {
  catalog: "bb_public_catalog_cache_v3",
  groups: "bb_public_groups_cache_v2",
  settings: "bb_public_settings_cache_v2",
  products: "bb_public_products_cache_v2",
};

const ENDPOINTS: Record<PublicDataKind, string> = {
  catalog: "/api/catalog",
  groups: "/api/groups",
  settings: "/api/settings",
  products: "/api/products",
};

const FRESH_MS: Record<PublicDataKind, number> = {
  catalog: 30_000,
  groups: 30_000,
  settings: 8_000,
  products: 30_000,
};

const LEGACY_PRODUCTS_KEY = "bb_products_v1";
const LEGACY_CAMPAIGNS_KEY = "bb_campaigns_v1";
const LEGACY_SETTINGS_KEY = "bb_settings_v6";

const memory = new Map<PublicDataKind, CacheEntry>();
const inflight = new Map<PublicDataKind, Promise<CacheEntry>>();

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

function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function isPlainObject(value: any): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
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

function normalizeSettingsPayload(value: any) {
  if (isPlainObject(value?.settings)) return value.settings;
  if (isPlainObject(value?.data)) return value.data;

  if (!isPlainObject(value)) return {};

  const out: Record<string, any> = {};

  for (const [key, item] of Object.entries(value)) {
    if (
      [
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
      ].includes(key)
    ) {
      continue;
    }

    out[key] = item;
  }

  return out;
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

      return {
        payload: {
          ok: true,
          source: "client_cache",
          products,
          items: products,
          campaigns,
          counts: {
            products: products.length,
            campaigns: campaigns.length,
          },
        },
        updatedAt: 0,
        status: 200,
        statusText: "OK",
      };
    }

    if (kind === "products") {
      const products = safeJsonParse<any[]>(
        localStorage.getItem(LEGACY_PRODUCTS_KEY),
        [],
      );

      if (!products.length) return null;

      return {
        payload: {
          ok: true,
          source: "client_cache",
          products,
          items: products,
          count: products.length,
        },
        updatedAt: 0,
        status: 200,
        statusText: "OK",
      };
    }

    if (kind === "settings") {
      const settings = safeJsonParse<Record<string, any>>(
        localStorage.getItem(LEGACY_SETTINGS_KEY),
        {},
      );

      if (!Object.keys(settings).length) return null;

      return {
        payload: {
          ok: true,
          source: "client_cache",
          ...settings,
        },
        updatedAt: 0,
        status: 200,
        statusText: "OK",
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
        });
        continue;
      }
    } catch {}

    const legacy = legacyEntry(kind);
    if (legacy) memory.set(kind, legacy);
  }
}

function persistEntry(kind: PublicDataKind, entry: CacheEntry) {
  memory.set(kind, entry);

  if (!isBrowser()) return;

  try {
    localStorage.setItem(CACHE_KEYS[kind], JSON.stringify(entry));
  } catch {}

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

      localStorage.setItem(LEGACY_PRODUCTS_KEY, JSON.stringify(products));
      localStorage.setItem(LEGACY_CAMPAIGNS_KEY, JSON.stringify(campaigns));
    }

    if (kind === "products") {
      const products = Array.isArray(entry.payload?.products)
        ? entry.payload.products
        : Array.isArray(entry.payload?.items)
          ? entry.payload.items
          : [];

      if (products.length) {
        localStorage.setItem(LEGACY_PRODUCTS_KEY, JSON.stringify(products));
      }
    }

    if (kind === "settings") {
      const settings = normalizeSettingsPayload(entry.payload);

      if (Object.keys(settings).length) {
        localStorage.setItem(LEGACY_SETTINGS_KEY, JSON.stringify(settings));
      }
    }
  } catch {}
}

function dispatchSyntheticStorage(key: string, value: any) {
  try {
    window.dispatchEvent(
      new StorageEvent("storage", {
        key,
        newValue: JSON.stringify(value ?? null),
        storageArea: window.localStorage,
      }),
    );
  } catch {
    try {
      window.dispatchEvent(new Event("storage"));
    } catch {}
  }
}

function notifyUpdated(kind: PublicDataKind, payload: any) {
  if (!isBrowser()) return;

  try {
    window.dispatchEvent(
      new CustomEvent("bb:public-data-updated", {
        detail: {
          kind,
          payload,
        },
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

    dispatchSyntheticStorage(
      LEGACY_PRODUCTS_KEY,
      payload?.products ?? payload?.items ?? [],
    );
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
    dispatchSyntheticStorage(
      LEGACY_SETTINGS_KEY,
      normalizeSettingsPayload(payload),
    );
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

  if (inflight.has(kind)) {
    return inflight.get(kind)!;
  }

  const request = (async () => {
    const fetcher =
      nativeFetch ||
      ((window as any).__bbNativePublicFetch as typeof window.fetch | undefined) ||
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
    };

    if (response.ok && payload?.ok !== false) {
      persistEntry(kind, entry);
      notifyUpdated(kind, payload);
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

  try {
    const fresh = await networkRequest(kind);

    if (fresh.status >= 200 && fresh.status < 300 && fresh.payload?.ok !== false) {
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

  const entry: CacheEntry = {
    payload:
      kind === "settings"
        ? {
            ok: true,
            source: "event",
            ...normalizeSettingsPayload(payload),
          }
        : payload,
    updatedAt: Date.now(),
    status: 200,
    statusText: "OK",
  };

  persistEntry(kind, entry);
}

function normalizeCategory(value: any) {
  const text = String(value || "")
    .trim()
    .toLowerCase();

  if (text.includes("vegan") || text.includes("vegetar")) return "vegan";
  if (text.includes("drink") || text.includes("getränk") || text.includes("getraenk")) {
    return "drinks";
  }
  if (text.includes("sauce") || text.includes("soß") || text.includes("sos")) {
    return "sauces";
  }
  if (text.includes("hotdog") || text.includes("hot dog")) return "hotdogs";
  if (text.includes("donut") || text.includes("doughnut")) return "donuts";
  if (text.includes("bubble") || text.includes("boba")) return "bubbletea";
  if (text.includes("extra") || text.includes("pommes") || text.includes("fries")) {
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
    .filter((product: any) => normalizeCategory(product?.category) === category)
    .map(imageUrlOf)
    .filter(Boolean);

  let groupUrls: string[] = [];

  if (category === "extras") {
    const list = Array.isArray(groups?.extraGroups) ? groups.extraGroups : [];
    groupUrls = list.flatMap((group: any) => [
      imageUrlOf(group),
      ...(Array.isArray(group?.variants)
        ? group.variants.map(imageUrlOf)
        : []),
    ]);
  }

  if (category === "drinks") {
    const list = Array.isArray(groups?.drinkGroups) ? groups.drinkGroups : [];
    groupUrls = list.flatMap((group: any) => [
      imageUrlOf(group),
      ...(Array.isArray(group?.variants)
        ? group.variants.map(imageUrlOf)
        : []),
    ]);
  }

  preloadUrls([...productUrls, ...groupUrls], category === "burger" ? 12 : 8);
}

export function installPublicDataFetchCache() {
  if (!isBrowser()) return;

  hydrateLocalCache();

  const globalWindow = window as any;

  if (globalWindow.__bbPublicFetchInstalled) {
    installed = true;
    nativeFetch =
      globalWindow.__bbNativePublicFetch ||
      window.fetch.bind(window);
    return;
  }

  nativeFetch = window.fetch.bind(window);
  globalWindow.__bbNativePublicFetch = nativeFetch;

  const wrappedFetch: typeof window.fetch = async (input, init) => {
    if (
      !currentPathAllowsCache() ||
      requestMethod(input, init) !== "GET" ||
      String(
        typeof Request !== "undefined" && input instanceof Request
          ? input.headers.get("x-bb-client-cache-bypass") || ""
          : new Headers(init?.headers).get("x-bb-client-cache-bypass") || "",
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
        void refreshPublicData(kind, {
          force: true,
        });
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
  installed = true;
}

export function isPublicDataFetchCacheInstalled() {
  return installed;
}
