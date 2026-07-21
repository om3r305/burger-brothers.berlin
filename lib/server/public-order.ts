import { randomBytes, timingSafeEqual } from "node:crypto";

function plainObject(value: any): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cleanText(value: any) {
  return String(value ?? "").trim();
}

function numberOrNull(value: any) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isoOrNull(value: any) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.valueOf()) ? date.toISOString() : null;
}

export function createTrackingToken() {
  return randomBytes(32).toString("base64url");
}

export function readOrderTrackingToken(order: any) {
  const meta = plainObject(order?.meta);
  return cleanText(meta?.trackingToken ?? meta?.publicTrackingToken);
}

export function extractTrackingToken(req: Request, body?: any) {
  let query = "";

  try {
    const url = new URL(req.url);
    query =
      url.searchParams.get("trackingToken") ||
      url.searchParams.get("token") ||
      url.searchParams.get("accessToken") ||
      "";
  } catch {}

  const header =
    req.headers.get("x-order-tracking-token") ||
    req.headers.get("x-tracking-token") ||
    "";

  const candidates = [
    body?.trackingToken,
    body?.token,
    body?.accessToken,
    header,
    query,
  ];

  return candidates.map((value) => cleanText(value)).find(Boolean) || "";
}

export function matchesTrackingToken(order: any, candidateRaw: any) {
  const expected = Buffer.from(readOrderTrackingToken(order));
  const candidate = Buffer.from(cleanText(candidateRaw));

  if (!expected.length || expected.length !== candidate.length) return false;

  try {
    return timingSafeEqual(expected, candidate);
  } catch {
    return false;
  }
}

export function publicOrderDto(order: any) {
  const meta = plainObject(order?.meta);
  const payment = plainObject(meta?.payment ?? order?.payment);
  const status = cleanText(meta?.statusManual ?? order?.status ?? "new") || "new";
  const mode = cleanText(order?.mode ?? "delivery") || "delivery";

  return {
    id: cleanText(order?.id),
    orderId: cleanText(order?.id),
    status,
    mode,
    planned: order?.planned ?? null,
    etaMin: numberOrNull(order?.etaMin),
    etaAdjustMin: numberOrNull(order?.etaAdjustMin ?? meta?.etaAdjustMin) ?? 0,
    payment: {
      method: cleanText(
        meta?.paymentMethod ?? payment?.method ?? order?.paymentMethod,
      ) || null,
      status: cleanText(
        meta?.paymentStatus ?? payment?.status ?? order?.paymentStatus,
      ) || null,
    },
    updatedAt: isoOrNull(order?.updatedAt ?? order?.ts),
    doneAt: isoOrNull(order?.doneAt ?? meta?.doneAt),
    cancelledAt: isoOrNull(order?.cancelledAt ?? meta?.cancelledAt),
  };
}

export function publicTrackingSessionDto(session: any) {
  const last = plainObject(session?.last);
  const lat = numberOrNull(last?.lat);
  const lng = numberOrNull(last?.lng);

  return {
    active: session?.active === true,
    updatedAt: isoOrNull(session?.updatedAt),
    last:
      lat == null || lng == null
        ? null
        : {
            // Yaklaşık konum: hassasiyet yaklaşık 11 metreye düşürülür.
            lat: Math.round(lat * 10_000) / 10_000,
            lng: Math.round(lng * 10_000) / 10_000,
            ts: numberOrNull(last?.ts),
          },
  };
}
