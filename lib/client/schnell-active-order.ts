export type SchnellActiveOrder = {
  orderId: string;
  customerNumber: number;
  savedAt: number;
};

const ACTIVE_ORDER_KEY = "bb_schnell_active_order_v1";
const ACTIVE_ORDER_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function cleanOrderId(value: unknown) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 120);
}

export function saveSchnellActiveOrder(
  orderId: unknown,
  customerNumber: unknown,
) {
  if (typeof window === "undefined") return;

  const cleanId = cleanOrderId(orderId);
  if (!cleanId) return;

  const record: SchnellActiveOrder = {
    orderId: cleanId,
    customerNumber: Math.max(0, Math.trunc(Number(customerNumber) || 0)),
    savedAt: Date.now(),
  };

  try {
    window.localStorage.setItem(ACTIVE_ORDER_KEY, JSON.stringify(record));
  } catch {
    // The success URL still works when storage is unavailable.
  }
}

export function readSchnellActiveOrder(): SchnellActiveOrder | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(ACTIVE_ORDER_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<SchnellActiveOrder>;
    const orderId = cleanOrderId(parsed.orderId);
    const savedAt = Number(parsed.savedAt || 0);

    if (
      !orderId ||
      !Number.isFinite(savedAt) ||
      savedAt <= 0 ||
      Date.now() - savedAt > ACTIVE_ORDER_MAX_AGE_MS
    ) {
      window.localStorage.removeItem(ACTIVE_ORDER_KEY);
      return null;
    }

    return {
      orderId,
      customerNumber: Math.max(
        0,
        Math.trunc(Number(parsed.customerNumber) || 0),
      ),
      savedAt,
    };
  } catch {
    return null;
  }
}

export function clearSchnellActiveOrder(orderId?: unknown) {
  if (typeof window === "undefined") return;

  try {
    if (orderId) {
      const current = readSchnellActiveOrder();
      const expected = cleanOrderId(orderId);
      if (current && expected && current.orderId !== expected) return;
    }
    window.localStorage.removeItem(ACTIVE_ORDER_KEY);
  } catch {
    // Nothing else is required when storage is unavailable.
  }
}
