import { NextResponse, type NextRequest } from "next/server";
import { verifySessionToken } from "@/lib/server/session";

const ADMIN_COOKIE = process.env.ADMIN_COOKIE_NAME || "bb_admin_sess";
const TV_COOKIE = "bb_tv_auth";
const DRIVER_COOKIE = "bb_driver_sess";

const PUBLIC_PATHS = new Set([
  "/admin/login",
  "/admin/manifest.webmanifest",
  "/api/admin/login",
  "/tv/login",
  "/api/tv/login",
  "/api/stripe/webhook",
  "/api/orders/create",
  "/api/payments/prepare",
  "/api/coupons/validate",
  "/favicon.ico",
  "/manifest.webmanifest",
  "/site.webmanifest",
  "/robots.txt",
  "/sitemap.xml",
  "/sw.js",
]);

const PUBLIC_PREFIXES = [
  "/_next",
  "/static",
  "/images",
  "/img",
  "/icons",
  "/logo",
  "/fonts",
  "/assets",
];

function child(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function publicAsset(path: string) {
  if (path.startsWith("/api/")) return false;
  if (PUBLIC_PATHS.has(path)) return true;
  if (PUBLIC_PREFIXES.some((prefix) => child(path, prefix))) return true;

  return false;
}

function unauthorized(req: NextRequest, target: string) {
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const url = req.nextUrl.clone();
  url.pathname = target;
  url.search = "";
  url.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

export type Access = "public" | "admin" | "operational" | "driver" | "token";

export function apiAccess(path: string, methodRaw: string): Access {
  const method = methodRaw.toUpperCase();
  const readOnly = method === "GET" || method === "HEAD" || method === "OPTIONS";

  if (PUBLIC_PATHS.has(path)) return "public";

  if (path === "/api/settings" && readOnly) return "public";
  if (path === "/api/products" && readOnly) return "public";
  if (path === "/api/catalog" && readOnly) return "public";
  if (path === "/api/groups" && readOnly) return "public";
  if (path === "/api/pause" && readOnly) return "public";
  if (path === "/api/analytics/collect" && method === "POST") return "public";
  if (path === "/api/track/lookup" && (method === "GET" || method === "POST")) return "public";
  if (child(path, "/api/track/by-order") && readOnly) return "public";
  if (child(path, "/api/track") && readOnly) return "public";

  // Customer payment routes perform strong checkout/share-token validation in-route.
  if (
    path === "/api/payments/profile" &&
    (method === "GET" || method === "POST" || method === "DELETE")
  ) {
    return "public";
  }
  if (
    path === "/api/payments/share" &&
    (method === "GET" || method === "POST")
  ) {
    return "public";
  }

  // Logout endpoints only expire their own cookies.
  if (
    path === "/api/tv/logout" &&
    (method === "GET" || method === "POST")
  ) {
    return "public";
  }

  // Driver login/logout stay reachable. Driver enumeration and management do not.
  if (
    path === "/api/drivers" &&
    (method === "POST" || method === "DELETE")
  ) {
    return "public";
  }
  if (path === "/api/drivers") return "admin";

  // Server-to-server endpoints validate their own strong tokens in-route.
  if (path === "/api/print/jobs" || path === "/api/print/mark") return "token";
  if (child(path, "/api/admin/cron")) return "token";

  if (child(path, "/api/admin")) return "admin";

  if (
    path === "/api/bootstrap" ||
    path === "/api/products" ||
    path === "/api/coupons" ||
    path === "/api/catalog" ||
    path === "/api/groups"
  ) {
    return "admin";
  }

  if (path === "/api/orders/claim") return "driver";
  if (child(path, "/api/qr-image")) return "operational";
  if (child(path, "/api/telegram")) return "admin";
  if (path === "/api/orders/list" || path === "/api/orders/status") return "operational";

  // Legacy multi-purpose endpoint is never public.
  if (path === "/api/orders") return "operational";

  if (child(path, "/api/track") && !readOnly) return "driver";

  if (
    path === "/api/pause" ||
    child(path, "/api/print/test") ||
    child(path, "/api/brian") ||
    child(path, "/api/diagnostics") ||
    child(path, "/api/tv/debug")
  ) {
    return "operational";
  }

  // Unknown reads stay reachable; unknown mutations fail closed.
  return readOnly ? "public" : "admin";
}

function createNonce() {
  return crypto.randomUUID().replaceAll("-", "");
}

export function contentSecurityPolicy(nonce: string) {
  const developmentEval = process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'";
  const upgrade = process.env.NODE_ENV === "production" ? "; upgrade-insecure-requests" : "";

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self' https://checkout.stripe.com",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${developmentEval} https://js.stripe.com`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "media-src 'self' blob: https:",
    "connect-src 'self' https://api.stripe.com https://*.stripe.com https://*.supabase.co wss://*.supabase.co",
    "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://checkout.stripe.com https://www.openstreetmap.org",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join("; ") + upgrade;
}

function nextPageResponse(req: NextRequest) {
  const nonce = createNonce();
  const csp = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

function allowRequest(req: NextRequest) {
  return req.nextUrl.pathname.startsWith("/api/")
    ? NextResponse.next()
    : nextPageResponse(req);
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (publicAsset(path)) return NextResponse.next();

  const adminPage = child(path, "/admin") || child(path, "/dashboard");
  const tvPage = child(path, "/tv") || child(path, "/print");
  const access = path.startsWith("/api/") ? apiAccess(path, req.method) : "public";

  if (!adminPage && !tvPage && (access === "public" || access === "token")) {
    return allowRequest(req);
  }

  const adminOk = await verifySessionToken(
    req.cookies.get(ADMIN_COOKIE)?.value || "",
    "admin",
  );

  if (adminPage || access === "admin") {
    return adminOk ? allowRequest(req) : unauthorized(req, "/admin/login");
  }

  const tvOk = await verifySessionToken(
    req.cookies.get(TV_COOKIE)?.value || "",
    "tv",
  );

  if (tvPage) {
    return tvOk || adminOk
      ? allowRequest(req)
      : unauthorized(req, "/tv/login");
  }

  const driverOk = await verifySessionToken(
    req.cookies.get(DRIVER_COOKIE)?.value || "",
    "driver",
  );

  if (access === "driver") {
    return driverOk || adminOk
      ? allowRequest(req)
      : unauthorized(req, "/driver");
  }

  if (access === "operational") {
    return driverOk || tvOk || adminOk
      ? allowRequest(req)
      : unauthorized(req, "/driver");
  }

  return allowRequest(req);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
