import { createHmac, timingSafeEqual } from "crypto";

function paymentSigningSecret() {
  const secret = String(process.env.PAYMENT_FINALIZE_SECRET || "").trim();

  if (secret.length < 32) {
    throw new Error("PAYMENT_FINALIZE_SECRET_MISSING");
  }

  return secret;
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);

  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

export function signPaymentFinalize(paymentSessionId: string, finalOrderId: string) {
  const payload = `${paymentSessionId}:${finalOrderId}`;

  return createHmac("sha256", paymentSigningSecret())
    .update(payload)
    .digest("hex");
}

export function verifyPaymentFinalizeSignature(
  paymentSessionId: string,
  finalOrderId: string,
  signature: string,
) {
  if (!paymentSessionId || !finalOrderId || !signature) return false;

  try {
    return safeEqual(
      signPaymentFinalize(paymentSessionId, finalOrderId),
      String(signature).trim(),
    );
  } catch {
    return false;
  }
}
