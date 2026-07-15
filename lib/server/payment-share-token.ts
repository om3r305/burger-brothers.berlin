import { createHash, createHmac, timingSafeEqual } from "crypto";

export type PaymentShareTokenPayload = {
  version: 1;
  paymentSessionId: string;
  shareIndex: number;
  expiresAt: number;
};

function paymentTokenSecret() {
  const secret = String(process.env.STRIPE_SECRET_KEY || "").trim();

  if (!secret) {
    throw new Error("STRIPE_SECRET_KEY_MISSING");
  }

  return `burger-brothers:payment-share:${secret}`;
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);

  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

function signEncodedPayload(encodedPayload: string) {
  return createHmac("sha256", paymentTokenSecret())
    .update(encodedPayload)
    .digest("base64url");
}

export function createPaymentShareToken(params: {
  paymentSessionId: string;
  shareIndex: number;
  expiresAt: number;
}) {
  const payload: PaymentShareTokenPayload = {
    version: 1,
    paymentSessionId: String(params.paymentSessionId || "").trim(),
    shareIndex: Math.max(0, Math.round(Number(params.shareIndex) || 0)),
    expiresAt: Math.max(0, Math.round(Number(params.expiresAt) || 0)),
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signature = signEncodedPayload(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

export function verifyPaymentShareToken(
  tokenRaw: string,
): PaymentShareTokenPayload | null {
  const token = String(tokenRaw || "").trim();
  const [encodedPayload, suppliedSignature, ...rest] = token.split(".");

  if (!encodedPayload || !suppliedSignature || rest.length) return null;

  try {
    const expectedSignature = signEncodedPayload(encodedPayload);

    if (!safeEqual(expectedSignature, suppliedSignature)) return null;

    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as PaymentShareTokenPayload;

    if (payload?.version !== 1) return null;
    if (!String(payload?.paymentSessionId || "").startsWith("PAY-")) return null;
    if (!Number.isInteger(payload?.shareIndex) || payload.shareIndex < 0) {
      return null;
    }
    if (!Number.isFinite(payload?.expiresAt)) return null;
    if (payload.expiresAt <= Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}

export function hashPaymentShareToken(tokenRaw: string) {
  return createHash("sha256")
    .update(String(tokenRaw || "").trim())
    .digest("hex");
}

export function buildPaymentShareUrl(baseUrl: string, token: string) {
  const safeBase = String(baseUrl || "").replace(/\/+$/, "");
  return `${safeBase}/pay/${encodeURIComponent(token)}`;
}
