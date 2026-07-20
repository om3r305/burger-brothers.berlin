import { createHash, randomBytes, timingSafeEqual } from "crypto";

const TOKEN_RE = /^[A-Za-z0-9_-]{32,180}$/;

export function createPaymentRecoveryToken() {
  return randomBytes(32).toString("base64url");
}

export function normalizePaymentRecoveryToken(value: any) {
  const token = String(value || "").trim();
  return TOKEN_RE.test(token) ? token : "";
}

export function normalizePaymentRequestId(value: any) {
  const requestId = String(value || "").trim();
  return TOKEN_RE.test(requestId) ? requestId : "";
}

export function hashPaymentRecoveryValue(value: string) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

export function paymentRecoveryValueMatches(value: string, expectedHash: string) {
  const cleanValue = String(value || "");
  const cleanHash = String(expectedHash || "").toLowerCase();
  if (!cleanValue || !/^[a-f0-9]{64}$/.test(cleanHash)) return false;

  const actual = Buffer.from(hashPaymentRecoveryValue(cleanValue), "hex");
  const expected = Buffer.from(cleanHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function paymentRecoveryExpiresAt(hours: number) {
  const safeHours = Math.max(1, Math.min(72, Math.round(Number(hours) || 24)));
  return new Date(Date.now() + safeHours * 60 * 60 * 1000);
}

export function buildPaymentManageUrl(params: {
  baseUrl: string;
  paymentSessionId: string;
  recoveryToken: string;
  split?: boolean;
}) {
  const url = new URL("/payment/return", params.baseUrl);
  url.searchParams.set("paymentSession", params.paymentSessionId);
  url.searchParams.set("recovery", params.recoveryToken);
  if (params.split) url.searchParams.set("split", "1");
  return url.toString();
}
