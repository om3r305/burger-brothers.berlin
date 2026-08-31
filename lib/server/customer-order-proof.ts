import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizeGermanPhone } from "@/lib/server/customer-identity";

const PROOF_TTL_MS = 30 * 60 * 1000;

type OrderProofPayload = {
  v: 1;
  phone: string;
  exp: number;
};

function secret() {
  return String(
    process.env.CUSTOMER_IDENTITY_SECRET || process.env.ADMIN_SESSION_SECRET || "",
  ).trim();
}

function signature(body: string) {
  const key = secret();
  if (!key) return "";
  return createHmac("sha256", key).update(`order-proof:${body}`).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export function createCustomerOrderProof(phoneRaw: string) {
  const phone = normalizeGermanPhone(phoneRaw);
  if (!phone || !secret()) return "";
  const payload: OrderProofPayload = {
    v: 1,
    phone,
    exp: Date.now() + PROOF_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = signature(body);
  return sig ? `${body}.${sig}` : "";
}

export function verifyCustomerOrderProof(proofRaw: unknown, phoneRaw: unknown) {
  const proof = String(proofRaw || "");
  const [body, sig] = proof.split(".");
  if (!body || !sig) return false;
  const expected = signature(body);
  if (!expected || !safeEqual(sig, expected)) return false;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OrderProofPayload;
    const phone = normalizeGermanPhone(String(phoneRaw || ""));
    return Boolean(
      payload?.v === 1 &&
        phone &&
        payload.phone === phone &&
        Number(payload.exp) > Date.now(),
    );
  } catch {
    return false;
  }
}
