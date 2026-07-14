import Stripe from "stripe";

let stripeClient: Stripe | null = null;

export function getStripeClient() {
  const secretKey = String(process.env.STRIPE_SECRET_KEY || "").trim();

  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY_MISSING");
  }

  if (!stripeClient) {
    stripeClient = new Stripe(secretKey, {
      maxNetworkRetries: 2,
      timeout: 10_000,
      appInfo: {
        name: "Burger Brothers Berlin",
        version: "1.0.0",
      },
    });
  }

  return stripeClient;
}

export function resolveBaseUrl(requestUrl?: string) {
  const configured = String(
    process.env.NEXT_PUBLIC_BASE_URL ||
      process.env.BASE_URL ||
      process.env.SITE_URL ||
      process.env.APP_URL ||
      "",
  )
    .trim()
    .replace(/\/+$/, "");

  if (configured) {
    return configured.startsWith("http") ? configured : `https://${configured}`;
  }

  if (requestUrl) {
    try {
      return new URL(requestUrl).origin;
    } catch {}
  }

  const vercelUrl = String(process.env.VERCEL_URL || "").trim().replace(/\/+$/, "");
  if (vercelUrl) {
    return `https://${vercelUrl}`;
  }

  return "http://localhost:3000";
}

export function stripeModeLabel() {
  const key = String(process.env.STRIPE_SECRET_KEY || "").trim();
  return key.startsWith("sk_live_") ? "live" : "test";
}
