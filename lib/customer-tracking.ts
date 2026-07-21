const LS_LAST_TRACK_TOKEN = "bb_last_track_order_id";
const LS_LAST_TRACK_TOKEN_LEGACY = "bb_last_tracking_order_id";
const LS_LAST_TRACK_ORDER_NUMBER = "bb_last_track_order_number";
const LS_TRACK_TOKEN_BY_ORDER = "bb_tracking_token_by_order_v1";

export const CUSTOMER_TRACKING_EVENT = "bb:last-track-order-updated";

export function cleanCustomerTrackingValue(value: any) {
  return String(value || "")
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "");
}

export function isPersonalTrackingToken(value: any) {
  const clean = cleanCustomerTrackingValue(value);
  return clean.length >= 32 && clean.length <= 160;
}

function normalizeOrderNumber(value: any) {
  return cleanCustomerTrackingValue(value).toUpperCase();
}

function readTokenMap() {
  if (typeof window === "undefined") return {} as Record<string, string>;

  try {
    const raw = localStorage.getItem(LS_TRACK_TOKEN_BY_ORDER);
    const parsed = raw ? JSON.parse(raw) : null;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {} as Record<string, string>;
    }

    const out: Record<string, string> = {};

    for (const [rawOrderId, rawToken] of Object.entries(parsed)) {
      const orderId = normalizeOrderNumber(rawOrderId);
      const token = cleanCustomerTrackingValue(rawToken);

      if (orderId && isPersonalTrackingToken(token)) {
        out[orderId] = token;
      }
    }

    return out;
  } catch {
    return {} as Record<string, string>;
  }
}

function writeTokenMap(map: Record<string, string>) {
  if (typeof window === "undefined") return;

  const entries = Object.entries(map)
    .filter(
      ([orderId, token]) =>
        Boolean(normalizeOrderNumber(orderId)) &&
        isPersonalTrackingToken(token),
    )
    .slice(-20);

  try {
    localStorage.setItem(
      LS_TRACK_TOKEN_BY_ORDER,
      JSON.stringify(Object.fromEntries(entries)),
    );
  } catch {}
}

export function rememberCustomerTracking(params: {
  trackingToken: any;
  orderId?: any;
  dispatch?: boolean;
}) {
  if (typeof window === "undefined") return false;

  const trackingToken = cleanCustomerTrackingValue(params.trackingToken);
  const orderId = normalizeOrderNumber(params.orderId);

  if (!isPersonalTrackingToken(trackingToken)) return false;

  try {
    localStorage.setItem(LS_LAST_TRACK_TOKEN, trackingToken);
    localStorage.setItem(LS_LAST_TRACK_TOKEN_LEGACY, trackingToken);

    if (orderId) {
      localStorage.setItem(LS_LAST_TRACK_ORDER_NUMBER, orderId);

      const map = readTokenMap();
      delete map[orderId];
      map[orderId] = trackingToken;
      writeTokenMap(map);
    }
  } catch {}

  if (params.dispatch !== false) {
    try {
      window.dispatchEvent(
        new CustomEvent(CUSTOMER_TRACKING_EVENT, {
          detail: {
            id: trackingToken,
            trackingToken,
            orderId: orderId || undefined,
          },
        }),
      );
    } catch {}
  }

  return true;
}

export function readLastCustomerTracking() {
  if (typeof window === "undefined") {
    return {
      trackingToken: "",
      orderId: "",
      displayValue: "",
    };
  }

  try {
    const current = cleanCustomerTrackingValue(
      localStorage.getItem(LS_LAST_TRACK_TOKEN) || "",
    );
    const legacy = cleanCustomerTrackingValue(
      localStorage.getItem(LS_LAST_TRACK_TOKEN_LEGACY) || "",
    );
    const trackingToken = isPersonalTrackingToken(current)
      ? current
      : isPersonalTrackingToken(legacy)
        ? legacy
        : "";
    const orderId = normalizeOrderNumber(
      localStorage.getItem(LS_LAST_TRACK_ORDER_NUMBER) || "",
    );

    if (trackingToken && current !== trackingToken) {
      localStorage.setItem(LS_LAST_TRACK_TOKEN, trackingToken);
    }

    return {
      trackingToken,
      orderId,
      displayValue: orderId || trackingToken,
    };
  } catch {
    return {
      trackingToken: "",
      orderId: "",
      displayValue: "",
    };
  }
}

export function resolveCustomerTrackingToken(value: any) {
  const clean = cleanCustomerTrackingValue(value);

  if (!clean) return "";
  if (isPersonalTrackingToken(clean)) return clean;
  if (typeof window === "undefined") return "";

  const orderId = normalizeOrderNumber(clean);
  const map = readTokenMap();
  const mapped = cleanCustomerTrackingValue(map[orderId] || "");

  if (isPersonalTrackingToken(mapped)) return mapped;

  const last = readLastCustomerTracking();

  if (
    orderId &&
    last.orderId &&
    orderId === normalizeOrderNumber(last.orderId) &&
    isPersonalTrackingToken(last.trackingToken)
  ) {
    return last.trackingToken;
  }

  return "";
}
