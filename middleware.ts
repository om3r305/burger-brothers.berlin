import { NextResponse, type NextRequest } from "next/server";
import { verifySessionToken } from "@/lib/server/session";

const ADMIN_COOKIE = process.env.ADMIN_COOKIE_NAME || "bb_admin_sess";
const TV_COOKIE = "bb_tv_auth";
const DRIVER_COOKIE = "bb_driver_sess";
const CUSTOMER_NOTIFICATION_DECISION_COOKIE =
  "bb_notification_prompt_decision_v1";

const PUBLIC_PATHS = new Set([
  "/admin/login",
  "/admin/manifest.webmanifest",
  "/api/admin/login",
  "/tv/login",
  "/api/tv/login",
  "/api/shop-status",
  "/api/stripe/webhook",
  "/api/orders/create",
  "/api/payments/prepare",
  "/api/coupons/validate",
  "/favicon.ico",
  "/logo-burger-brothers.png",
  "/manifest.webmanifest",
  "/manifest-schnellbestellung.webmanifest",
  "/site.webmanifest",
  "/robots.txt",
  "/sitemap.xml",
  "/sw.js",
  "/admin-sw.js",
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
  "/admin/icons",
];

const SHOP_STATUS_CACHE_MS = 2_500;
let shopStatusCache:
  | {
      expiresAt: number;
      closed: boolean;
      message: string;
    }
  | null = null;

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
  if (path === "/api/showcase" && readOnly) return "public";
  if (
    path === "/api/showcase/events" &&
    (readOnly || method === "POST")
  ) {
    return "public";
  }
  if (child(path, "/api/rewards/photos") && readOnly) return "public";
  if (path === "/api/products" && readOnly) return "public";
  if (path === "/api/catalog" && readOnly) return "public";
  if (path === "/api/groups" && readOnly) return "public";
  if (path === "/api/pause" && readOnly) return "public";
  if (path === "/api/analytics/collect" && method === "POST") return "public";

  // Customer AI assistant routes apply trusted-origin + rate-limit checks in-route.
  if (path === "/api/assistant/chat" && method === "POST") return "public";
  if (path === "/api/assistant/realtime" && method === "POST") return "public";
  if (path === "/api/assistant/delivery-area" && method === "POST") return "public";

  // BB Chef owns its login, signed Chef session, origin checks and role checks
  // inside the route. Middleware only keeps the endpoint reachable.
  if (path === "/api/chef" && (readOnly || method === "POST")) return "public";

  // Genel PWA/Web-Push uçları kendi origin, rate-limit, cihaz çerezi ve
  // tracking-token kontrollerini route içinde uygular.
  if (path === "/api/push" && ["GET", "POST", "PATCH", "DELETE"].includes(method)) {
    return "public";
  }
  if (path === "/api/push/pending" && readOnly) return "public";
  if (path === "/api/push/order" && method === "POST") return "public";
  if (path === "/api/route-deals/eligible" && method === "POST") return "public";

  // Schnellbestellung customer routes are public at the middleware layer,
  // while each route applies the controls relevant to it: signed QR or
  // session validation, trusted-origin checks, rate limits, canonical pricing
  // and idempotency. The access-token endpoint intentionally remains protected
  // for the in-store QR display.
  if (
    path === "/api/schnellbestellung/location/verify" &&
    method === "POST"
  ) {
    return "public";
  }
  if (path === "/api/schnellbestellung/catalog" && readOnly) return "public";
  if (path === "/api/schnellbestellung/manifest" && readOnly) return "public";
  if (path === "/api/schnellbestellung/session" && readOnly) return "public";
  if (path === "/api/schnellbestellung/status" && readOnly) return "public";
  if (
    path === "/api/schnellbestellung/push" &&
    (readOnly || method === "POST")
  ) {
    return "public";
  }
  if (path === "/api/schnellbestellung/orders" && method === "POST") {
    return "public";
  }
  // Kazanan isim/fotoğraf paylaşımı müşteri Schnell oturumu ile çalışır.
  // Middleware yalnız rotayı erişilebilir kılar; route içinde imzalı Schnell
  // session, trusted origin, rate limit, order sahipliği ve consent yeniden
  // doğrulanır.
  if (
    path === "/api/schnellbestellung/reward/submission" &&
    method === "POST"
  ) {
    return "public";
  }

  if (path === "/api/track/lookup" && (method === "GET" || method === "POST")) return "public";

  // Customer tracking token is verified inside the route.
  // Middleware must not require a driver cookie for this POST.
  if (path === "/api/track/route" && method === "POST") return "public";

  // Checkout customer route. Google server key remains server-side;
  // the route applies its own input validation and rate limit.
  if (path === "/api/maps/address/validate" && method === "POST") return "public";

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
  if (path === "/api/payments/session" && (method === "GET" || method === "POST")) {
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
  if (path === "/api/orders/list" || path === "/api/orders/status" || path === "/api/orders/notification") return "operational";

  // Legacy multi-purpose endpoint is never public.
  if (path === "/api/orders") return "operational";

  if (child(path, "/api/track") && !readOnly) return "driver";

  if (
    path === "/api/pause" ||
    path === "/api/print/token" ||
    child(path, "/api/print/test") ||
    child(path, "/api/brian") ||
    child(path, "/api/diagnostics") ||
    child(path, "/api/tv/debug")
  ) {
    return "operational";
  }

  // Unknown API routes fail closed. Public routes must be explicitly listed above.
  return "admin";
}

function createNonce() {
  return crypto.randomUUID().replaceAll("-", "");
}

export type ContentSecurityPolicyOptions = {
  allowLocalPrintProxy?: boolean;
};

export function contentSecurityPolicy(
  nonce: string,
  options: ContentSecurityPolicyOptions = {},
) {
  const developmentEval = process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'";
  const allowLocalPrintProxy = options.allowLocalPrintProxy === true;
  // The kitchen TV deliberately talks to an HTTP service on the same machine.
  // Keep that exception restricted to /tv; every other page retains the strict policy.
  const localPrintProxy = allowLocalPrintProxy ? " http://127.0.0.1:7777" : "";
  const upgrade =
    process.env.NODE_ENV === "production" && !allowLocalPrintProxy
      ? "; upgrade-insecure-requests"
      : "";

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
    `connect-src 'self' https://api.stripe.com https://*.stripe.com https://*.supabase.co wss://*.supabase.co https://maps.googleapis.com https://routes.googleapis.com https://*.r2.cloudflarestorage.com https://*.r2.dev${localPrintProxy}`,
    "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://checkout.stripe.com https://www.openstreetmap.org",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join("; ") + upgrade;
}

function nextPageResponse(req: NextRequest) {
  const nonce = createNonce();
  const allowLocalPrintProxy =
    child(req.nextUrl.pathname, "/tv") || child(req.nextUrl.pathname, "/print");
  const csp = contentSecurityPolicy(nonce, { allowLocalPrintProxy });
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

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function maintenancePageResponse(messageRaw: string) {
  const message = escapeHtml(
    messageRaw ||
      "Wir sind bald für euch da! 🍔🔥 Unser Online-Shop wird gerade vorbereitet und ist in Kürze verfügbar.",
  );
  const html = `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <meta http-equiv="refresh" content="5" />
  <meta name="robots" content="noindex,nofollow" />
  <title>Wartungsmodus · Burger Brothers Berlin</title>
  <style>
    html,body{margin:0;min-height:100%;background:#000;color:#fff;font-family:Arial,Helvetica,sans-serif}
    body{min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box}
    main{text-align:center;max-width:760px}
    img{width:140px;height:140px;object-fit:contain;display:block;margin:0 auto 20px}
    h1{font-size:22px;line-height:1.1;margin:0 0 8px;font-weight:700}
    p{font-size:14px;line-height:1.5;color:#d6d3d1;margin:0;white-space:pre-line}
  </style>
</head>
<body>
  <main>
    <img src="/logo-burger-brothers.png" alt="Burger Brothers Berlin" />
    <h1>Wartungsmodus</h1>
    <p>${message}</p>
  </main>
</body>
</html>`;

  return new NextResponse(html, {
    status: 503,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Content-Type": "text/html; charset=utf-8",
      "Retry-After": "5",
      "Content-Security-Policy":
        "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

function maintenanceApiResponse(message: string) {
  return NextResponse.json(
    {
      ok: false,
      error: "SHOP_CLOSED",
      message:
        message ||
        "Der Online-Shop ist vorübergehend geschlossen.",
    },
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Retry-After": "5",
      },
    },
  );
}

async function readShopStatus(req: NextRequest) {
  const now = Date.now();
  if (shopStatusCache && shopStatusCache.expiresAt > now) {
    return shopStatusCache;
  }

  try {
    const url = req.nextUrl.clone();
    url.pathname = "/api/shop-status";
    url.search = "";
    url.searchParams.set("probe", String(now));

    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: {
        accept: "application/json",
      },
    });
    const payload = await response.json().catch(() => null);
    const status = {
      expiresAt: now + SHOP_STATUS_CACHE_MS,
      closed: payload?.closed === true || !payload,
      message: String(payload?.message || ""),
    };
    shopStatusCache = status;
    return status;
  } catch {
    const status = {
      expiresAt: now + 1_000,
      closed: true,
      message: "Der Online-Shop ist vorübergehend nicht verfügbar.",
    };
    shopStatusCache = status;
    return status;
  }
}

function shouldEnforceShopStatus(
  path: string,
  methodRaw: string,
  access: Access,
) {
  if (path === "/api/shop-status") return false;
  if (path === "/api/admin/login") return false;
  if (path === "/api/stripe/webhook") return false;
  if (access === "token") return false;

  if (!path.startsWith("/api/")) return true;

  const method = methodRaw.toUpperCase();
  const readOnly = method === "GET" || method === "HEAD" || method === "OPTIONS";
  if (readOnly) return false;

  // These three routes perform a fresh DB-backed shop-status check inside the
  // business transaction path. Keeping them out of the middleware gate also
  // lets an already-paid, HMAC-verified Stripe order finalize safely.
  if (
    path === "/api/orders/create" ||
    path === "/api/payments/prepare" ||
    path === "/api/schnellbestellung/orders"
  ) {
    return false;
  }

  return true;
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  /*
    Eski ana ekran kısayolları /install?app=1 URL'sini açabilir. Kullanıcı daha
    önce karar verdiyse yükleme ekranını hiç render etmeden ana sayfaya gönder.
    /install?settings=1 bildirim ayarları için açık kalır.
  */
  if (
    path === "/install" &&
    req.nextUrl.searchParams.get("settings") !== "1"
  ) {
    const decision = req.cookies.get(
      CUSTOMER_NOTIFICATION_DECISION_COOKIE,
    )?.value;

    if (decision === "accepted" || decision === "declined") {
      const url = req.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  // Static assets and the admin login shell must remain reachable so the
  // maintenance response can render and the owner can always recover the shop.
  // /tv/login is intentionally excluded: TV is not an admin exception.
  if (publicAsset(path) && path !== "/tv/login") {
    return NextResponse.next();
  }

  const adminPage = child(path, "/admin") || child(path, "/dashboard");
  const tvPage = child(path, "/tv") || child(path, "/print");
  const access = path.startsWith("/api/") ? apiAccess(path, req.method) : "public";

  const adminCookie = req.cookies.get(ADMIN_COOKIE)?.value || "";
  const adminOk = adminCookie
    ? await verifySessionToken(adminCookie, "admin")
    : false;

  if (
    !adminPage &&
    !adminOk &&
    shouldEnforceShopStatus(path, req.method, access)
  ) {
    const shopStatus = await readShopStatus(req);
    if (shopStatus.closed) {
      return path.startsWith("/api/")
        ? maintenanceApiResponse(shopStatus.message)
        : maintenancePageResponse(shopStatus.message);
    }
  }

  // The TV login page is public only while the shop is open. The POST endpoint
  // follows the same maintenance gate above.
  if (path === "/tv/login") {
    return allowRequest(req);
  }

  if (!adminPage && !tvPage && (access === "public" || access === "token")) {
    return allowRequest(req);
  }

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