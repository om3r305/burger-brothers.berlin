import { createHash, createHmac, timingSafeEqual } from "crypto";

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

// Sign the JSON that actually crosses the internal HTTP boundary. Sorting keys
// permits harmless key reordering, while binding prices, items and all metadata.
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

export function signPaymentFinalize(paymentSessionId: string, finalOrderId: string, order: unknown) {
  if (!order || typeof order !== "object" || Array.isArray(order)) throw new Error("PAYMENT_ORDER_MISSING");
  const digest = createHash("sha256").update(JSON.stringify(canonical(JSON.parse(JSON.stringify(order))))).digest("hex");
  const payload = `${paymentSessionId}:${finalOrderId}:${digest}`;

  return createHmac("sha256", paymentSigningSecret())
    .update(payload)
    .digest("hex");
}

export function verifyPaymentFinalizeSignature(
  paymentSessionId: string,
  finalOrderId: string,
  signature: string,
  order: unknown,
) {
  if (!paymentSessionId || !finalOrderId || !signature) return false;

  try {
    return safeEqual(
      signPaymentFinalize(paymentSessionId, finalOrderId, order),
      String(signature).trim(),
    );
  } catch {
    return false;
  }
}
