// lib/pause.ts

/** Tüm uygulamada ortak kullanılacak LS anahtarı */
export const LS_PAUSE = "bb_pause_v1";

export type PauseState = {
  delivery: boolean;
  pickup: boolean;
};

/** Güvenli parse + normalize */
function normalizePause(obj: any): PauseState {
  return {
    delivery: !!obj?.delivery,
    pickup: !!obj?.pickup,
  };
}

/** Mevcut pause durumunu oku (yoksa false/false döner) */
export function readPause(): PauseState {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(LS_PAUSE) : null;
    if (!raw) return { delivery: false, pickup: false };
    return normalizePause(JSON.parse(raw));
  } catch {
    return { delivery: false, pickup: false };
  }
}

/** Yeni pause durumunu yaz ve cross-tab senkron için storage event yayınla */
export function writePause(next: PauseState): void {
  try {
    if (typeof window === "undefined") return;
    localStorage.setItem(LS_PAUSE, JSON.stringify(normalizePause(next)));
    // diğer tab’lara anında haber ver
    window.dispatchEvent(new StorageEvent("storage", { key: LS_PAUSE }));
  } catch {
    // no-op
  }
}

/** Belirli alanı toggle et (delivery/pickup) */
export function togglePause(kind: keyof PauseState): PauseState {
  const cur = readPause();
  const next = { ...cur, [kind]: !cur[kind] };
  writePause(next);
  return next;
}

/** Tüm pause'u temizle (ikisi de false) */
export function clearPause(): void {
  writePause({ delivery: false, pickup: false });
}

/** Görsel/iş mantığı: mevcut moda göre kapalı mı? */
export function isModePaused(
  mode: "pickup" | "delivery",
  state?: PauseState
): boolean {
  const p = state ?? readPause();
  return mode === "pickup" ? !!p.pickup : !!p.delivery;
}

/** Uygulama genelinde pause değişimini dinle.
 *  Dönüş: unsubscribe fonksiyonu
 */
export function onPauseChange(cb: (state: PauseState) => void): () => void {
  const handler = (ev: StorageEvent | Event) => {
    // Hem gerçek storage event’i hem de manual dispatch’i yakalayalım
    if (!(ev as StorageEvent).key || (ev as StorageEvent).key === LS_PAUSE) {
      cb(readPause());
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", handler as any);
  }
  // İlk state’i hemen gönder
  try {
    cb(readPause());
  } catch {}
  return () => {
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", handler as any);
    }
  };
}

/** (İsteğe bağlı) Basit metin mesajı üretici – UI’da uyarı bandı için kullanılabilir */
export function buildPauseMessage(state?: PauseState): string | null {
  const p = state ?? readPause();
  const msgs: string[] = [];
  if (p.delivery) msgs.push("Lieferung vorübergehend pausiert.");
  if (p.pickup) msgs.push("Abholung vorübergehend pausiert.");
  return msgs.length ? `⚠️ ${msgs.join(" ")}` : null;
}

/** (İsteğe bağlı) JSON şema guard – dış kaynaklardan gelen veri için */
export function isPauseState(obj: any): obj is PauseState {
  return obj && typeof obj === "object" && "delivery" in obj && "pickup" in obj;
}

/* -------------------------------------------------------------
 * Küçük kullanım örnekleri (component içinde):
 *
 * 1) Mod butonunu kilitlemek:
 *    const paused = readPause();
 *    const disabledDelivery = paused.delivery;
 *
 * 2) Cross-tab senkron:
 *    useEffect(() => onPauseChange(setPause), []);
 *
 * 3) Checkout’u kapatmak:
 *    const canCheckout = !isModePaused(orderMode, paused) && ...diğer koşullar
 * ------------------------------------------------------------- */
