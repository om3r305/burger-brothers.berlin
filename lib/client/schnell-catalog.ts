"use client";

type CatalogEnvelope<T> = {
  ok: boolean;
  status: number;
  data: T;
};

type CatalogWindow = Window &
  typeof globalThis & {
    __bbSchnellCatalogPromise?: Promise<CatalogEnvelope<unknown>>;
    __bbSchnellCatalogResult?: {
      savedAt: number;
      envelope: CatalogEnvelope<unknown>;
    };
  };

const CATALOG_URL = "/api/schnellbestellung/catalog";
const CATALOG_CACHE_KEY = "bb_schnell_catalog_v8";
const IN_MEMORY_RESULT_MAX_AGE_MS = 15_000;
const REQUEST_TIMEOUT_MS = 10_000;

function catalogWindow() {
  return window as CatalogWindow;
}

function saveBrowserCache(data: unknown) {
  if (!data || typeof data !== "object") return;

  const payload = data as {
    products?: unknown[];
    categories?: unknown[];
    settings?: unknown;
  };

  if (!Array.isArray(payload.products) || !Array.isArray(payload.categories)) {
    return;
  }

  try {
    window.localStorage.setItem(
      CATALOG_CACHE_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        products: payload.products,
        categories: payload.categories,
        settings: payload.settings || {},
      }),
    );
  } catch {
    // Local cache is an optional speed optimization.
  }
}

async function requestCatalog<T>(
  cacheMode: RequestCache = "default",
): Promise<CatalogEnvelope<T>> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(CATALOG_URL, {
      credentials: "same-origin",
      cache: cacheMode,
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    const data = (await response.json().catch(() => ({}))) as T;

    if (response.ok) saveBrowserCache(data);

    return {
      ok: response.ok,
      status: response.status,
      data,
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function loadSchnellCatalog<T>(options: {
  forceRefresh?: boolean;
  cacheMode?: RequestCache;
} = {}) {
  const state = catalogWindow();
  const recent = state.__bbSchnellCatalogResult;

  if (
    !options.forceRefresh &&
    recent &&
    Date.now() - recent.savedAt <= IN_MEMORY_RESULT_MAX_AGE_MS
  ) {
    return Promise.resolve(recent.envelope as CatalogEnvelope<T>);
  }

  if (state.__bbSchnellCatalogPromise) {
    return state.__bbSchnellCatalogPromise as Promise<CatalogEnvelope<T>>;
  }

  const promise = requestCatalog<T>(options.cacheMode || "default")
    .then((envelope) => {
      state.__bbSchnellCatalogResult = {
        savedAt: Date.now(),
        envelope: envelope as CatalogEnvelope<unknown>,
      };
      return envelope;
    })
    .finally(() => {
      window.setTimeout(() => {
        if (state.__bbSchnellCatalogPromise === promise) {
          state.__bbSchnellCatalogPromise = undefined;
        }
      }, IN_MEMORY_RESULT_MAX_AGE_MS);
    });

  state.__bbSchnellCatalogPromise =
    promise as Promise<CatalogEnvelope<unknown>>;
  return promise;
}

export function prefetchSchnellCatalog() {
  void loadSchnellCatalog<unknown>().catch(() => undefined);
}
