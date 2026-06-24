// lib/pause.ts

export const LS_PAUSE = "bb_pause_v1";

export type PauseState = {
  delivery: boolean;
  pickup: boolean;
};

const API_PATH = "/api/pause";

const DEFAULT_PAUSE: PauseState = {
  delivery: false,
  pickup: false,
};

function hasWindow() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function normalizePause(input: any): PauseState {
  const raw =
    input?.pause && typeof input.pause === "object"
      ? input.pause
      : input?.state && typeof input.state === "object"
        ? input.state
        : input?.value && typeof input.value === "object"
          ? input.value
          : input || {};

  return {
    delivery: !!raw?.delivery,
    pickup: !!raw?.pickup,
  };
}

function safeJsonParse(value: string | null) {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function dispatchPauseChanged(state: PauseState) {
  if (!hasWindow()) return;

  try {
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: LS_PAUSE,
        newValue: JSON.stringify(state),
        storageArea: window.localStorage,
      }),
    );
  } catch {
    try {
      window.dispatchEvent(new Event("storage"));
    } catch {}
  }

  try {
    window.dispatchEvent(new CustomEvent("bb_pause_changed", { detail: state }));
    window.dispatchEvent(new CustomEvent("bb:pause-sync", { detail: state }));
  } catch {}
}

function writePauseLocal(next: PauseState): PauseState {
  const normalized = normalizePause(next);

  if (!hasWindow()) return normalized;

  try {
    localStorage.setItem(LS_PAUSE, JSON.stringify(normalized));
    dispatchPauseChanged(normalized);
  } catch {}

  return normalized;
}

/**
 * Local cache okur.
 * Ana kaynak DB değildir; sadece offline/fallback snapshot.
 */
export function readPause(): PauseState {
  if (!hasWindow()) return DEFAULT_PAUSE;

  try {
    const parsed = safeJsonParse(localStorage.getItem(LS_PAUSE));
    return normalizePause(parsed || DEFAULT_PAUSE);
  } catch {
    return DEFAULT_PAUSE;
  }
}

/**
 * Sunucudan pause durumunu çeker.
 * Ana kaynak: /api/pause → DB/Setting.pause
 * Fallback: local cache
 */
export async function fetchPause(): Promise<PauseState> {
  if (!hasWindow()) return DEFAULT_PAUSE;

  try {
    const res = await fetch(`${API_PATH}?ts=${Date.now()}`, {
      method: "GET",
      cache: "no-store",
      headers: {
        accept: "application/json",
      },
    });

    if (!res.ok) {
      return readPause();
    }

    const data = await res.json().catch(() => null);
    const normalized = normalizePause(data);

    writePauseLocal(normalized);

    return normalized;
  } catch {
    return readPause();
  }
}

async function pushPauseToServer(state: PauseState): Promise<PauseState> {
  const normalized = normalizePause(state);

  if (!hasWindow()) return normalized;

  const res = await fetch(API_PATH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(normalized),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || `Pause konnte nicht gespeichert werden. HTTP ${res.status}`);
  }

  return normalizePause(data);
}

/**
 * Kompatibilitätsfunktion:
 * UI lokal hızlı güncellenir, sonra DB’ye gönderilir.
 * Yeni DB-first ekranlarda mümkünse setPauseRemote kullanılmalı.
 */
export function writePause(next: PauseState): void {
  if (!hasWindow()) return;

  const normalized = writePauseLocal(next);

  void pushPauseToServer(normalized)
    .then((serverState) => {
      writePauseLocal(serverState);
    })
    .catch(() => {
      // Eski bileşen uyumluluğu için local snapshot korunur.
      // DB-first ekranlarda setPauseRemote hata fırlatır ve UI geri alır.
    });
}

export function togglePause(kind: keyof PauseState): PauseState {
  const current = readPause();

  const next: PauseState = {
    ...current,
    [kind]: !current[kind],
  };

  writePause(next);

  return next;
}

export function clearPause(): void {
  writePause(DEFAULT_PAUSE);
}

export function isModePaused(
  mode: "pickup" | "delivery",
  state?: PauseState,
): boolean {
  const pause = state ?? readPause();

  return mode === "pickup" ? !!pause.pickup : !!pause.delivery;
}

export function onPauseChange(cb: (state: PauseState) => void): () => void {
  if (!hasWindow()) {
    try {
      cb(DEFAULT_PAUSE);
    } catch {}

    return () => {};
  }

  const emitCurrent = () => {
    try {
      cb(readPause());
    } catch {}
  };

  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key === LS_PAUSE) {
      emitCurrent();
    }
  };

  const onCustom = (event: Event) => {
    const custom = event as CustomEvent<PauseState>;

    if (custom?.detail) {
      try {
        cb(normalizePause(custom.detail));
        return;
      } catch {}
    }

    emitCurrent();
  };

  window.addEventListener("storage", onStorage);
  window.addEventListener("bb_pause_changed", onCustom as EventListener);
  window.addEventListener("bb:pause-sync", onCustom as EventListener);

  emitCurrent();

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("bb_pause_changed", onCustom as EventListener);
    window.removeEventListener("bb:pause-sync", onCustom as EventListener);
  };
}

export function buildPauseMessage(state?: PauseState): string | null {
  const pause = state ?? readPause();
  const messages: string[] = [];

  if (pause.delivery) {
    messages.push("Lieferung vorübergehend pausiert.");
  }

  if (pause.pickup) {
    messages.push("Abholung vorübergehend pausiert.");
  }

  return messages.length ? `⚠️ ${messages.join(" ")}` : null;
}

export function isPauseState(obj: any): obj is PauseState {
  if (!obj || typeof obj !== "object") return false;

  return "delivery" in obj && "pickup" in obj;
}

/**
 * Server → local cache.
 * App mount, Checkout, TV veya Admin tarafında çağrılabilir.
 */
export async function syncPauseFromServer(): Promise<PauseState> {
  const state = await fetchPause();
  return writePauseLocal(state);
}

/**
 * DB-first set:
 * Önce API’ye yazar, gelen cevabı local cache’e işler.
 * API başarısız olursa hata fırlatır; çağıran UI eski state’e dönebilir.
 */
export async function setPauseRemote(next: PauseState): Promise<PauseState> {
  const normalized = normalizePause(next);

  if (!hasWindow()) return normalized;

  const serverState = await pushPauseToServer(normalized);
  return writePauseLocal(serverState);
}