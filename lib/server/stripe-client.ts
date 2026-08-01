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

function normalizeConfiguredBaseUrl(raw: string) {
  const configured = String(raw || "").trim().replace(/\/+$/, "");
  if (!configured) return "";

  const candidate = configured.startsWith("http")
    ? configured
    : `https://${configured}`;
  const parsed = new URL(candidate);

  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("BASE_URL_INVALID");
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    throw new Error("BASE_URL_HTTPS_REQUIRED");
  }

  return parsed.origin;
}

export function resolveBaseUrl(requestUrl?: string) {
  const configured = normalizeConfiguredBaseUrl(
    process.env.NEXT_PUBLIC_BASE_URL ||
      process.env.BASE_URL ||
      process.env.SITE_URL ||
      process.env.APP_URL ||
      "",
  );

  if (configured) return configured;

  const production =
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production";

  if (production) {
    throw new Error("CANONICAL_BASE_URL_MISSING");
  }

  if (requestUrl) {
    try {
      return new URL(requestUrl).origin;
    } catch {
      // Development-only fallback continues below.
    }
  }

  const vercelUrl = String(process.env.VERCEL_URL || "")
    .trim()
    .replace(/\/+$/, "");
  if (vercelUrl) {
    return `https://${vercelUrl}`;
  }

  return "http://localhost:3000";
}

export function stripeModeLabel() {
  const key = String(process.env.STRIPE_SECRET_KEY || "").trim();
  return key.startsWith("sk_live_") ? "live" : "test";
}

export function getStripePublishableKey() {
  const key = String(
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
      process.env.STRIPE_PUBLISHABLE_KEY ||
      "",
  ).trim();
  if (!key) throw new Error("STRIPE_PUBLISHABLE_KEY_MISSING");
  return key;
}
