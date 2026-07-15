import { createHash, createHmac, timingSafeEqual } from "crypto";
import type Stripe from "stripe";
import type { NextResponse } from "next/server";

const PAYMENT_PROFILE_COOKIE = "bb_payment_profile";
const PROFILE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

type PaymentProfilePayload = {
  version: 1;
  stripeCustomerId: string;
  phoneHash: string;
  expiresAt: number;
};

function profileSecret() {
  const secret = String(process.env.STRIPE_SECRET_KEY || "").trim();

  if (!secret) {
    throw new Error("STRIPE_SECRET_KEY_MISSING");
  }

  return `burger-brothers:payment-profile:${secret}`;
}

function normalizePhone(value: any) {
  return String(value || "").replace(/\D/g, "");
}

export function paymentProfilePhoneHash(value: any) {
  const phone = normalizePhone(value);

  if (!phone) return "";

  return createHash("sha256")
    .update(`burger-brothers:phone:${phone}`)
    .digest("hex");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);

  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

function signPayload(encodedPayload: string) {
  return createHmac("sha256", profileSecret())
    .update(encodedPayload)
    .digest("base64url");
}

function readCookie(req: Request, name: string) {
  const cookieHeader = req.headers.get("cookie") || "";

  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    const index = trimmed.indexOf("=");

    if (index < 0) continue;

    const key = trimmed.slice(0, index).trim();
    if (key !== name) continue;

    const rawValue = trimmed.slice(index + 1).trim();

    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  return "";
}

function decodeProfileToken(tokenRaw: string): PaymentProfilePayload | null {
  const token = String(tokenRaw || "").trim();
  const [encodedPayload, suppliedSignature, ...rest] = token.split(".");

  if (!encodedPayload || !suppliedSignature || rest.length) return null;

  try {
    const expectedSignature = signPayload(encodedPayload);

    if (!safeEqual(expectedSignature, suppliedSignature)) return null;

    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as PaymentProfilePayload;

    if (payload?.version !== 1) return null;
    if (!String(payload?.stripeCustomerId || "").startsWith("cus_")) return null;
    if (!Number.isFinite(payload?.expiresAt)) return null;
    if (payload.expiresAt <= Math.floor(Date.now() / 1000)) return null;

    return {
      version: 1,
      stripeCustomerId: String(payload.stripeCustomerId),
      phoneHash: String(payload.phoneHash || ""),
      expiresAt: Number(payload.expiresAt),
    };
  } catch {
    return null;
  }
}

export function createPaymentProfileToken(params: {
  stripeCustomerId: string;
  phone?: string;
}) {
  const payload: PaymentProfilePayload = {
    version: 1,
    stripeCustomerId: String(params.stripeCustomerId || "").trim(),
    phoneHash: paymentProfilePhoneHash(params.phone),
    expiresAt: Math.floor(Date.now() / 1000) + PROFILE_MAX_AGE_SECONDS,
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );

  return `${encodedPayload}.${signPayload(encodedPayload)}`;
}

export async function resolvePaymentProfileCustomerId(params: {
  req: Request;
  stripe: Stripe;
  phone?: string;
  requirePhoneMatch?: boolean;
}) {
  const token = readCookie(params.req, PAYMENT_PROFILE_COOKIE);
  const payload = decodeProfileToken(token);

  if (!payload) return "";

  if (params.requirePhoneMatch) {
    const suppliedPhoneHash = paymentProfilePhoneHash(params.phone);

    if (
      payload.phoneHash &&
      suppliedPhoneHash &&
      !safeEqual(payload.phoneHash, suppliedPhoneHash)
    ) {
      return "";
    }
  }

  try {
    const customer = await params.stripe.customers.retrieve(
      payload.stripeCustomerId,
    );

    if ((customer as Stripe.DeletedCustomer)?.deleted) return "";

    return payload.stripeCustomerId;
  } catch {
    return "";
  }
}

export function setPaymentProfileCookie(params: {
  response: NextResponse;
  stripeCustomerId: string;
  phone?: string;
}) {
  const token = createPaymentProfileToken({
    stripeCustomerId: params.stripeCustomerId,
    phone: params.phone,
  });

  params.response.cookies.set({
    name: PAYMENT_PROFILE_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PROFILE_MAX_AGE_SECONDS,
  });

  return params.response;
}

export function clearPaymentProfileCookie(response: NextResponse) {
  response.cookies.set({
    name: PAYMENT_PROFILE_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return response;
}
