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

function publicAsset(path: string) {
  if (PUBLIC_PATHS.has(path)) return true;
  if (PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;

  return /\.(png|jpg|jpeg|webp|gif|svg|ico|avif|css|js|map|woff2?|ttf|otf)$/i.test(
    path,
  );
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

type Access = "public" | "admin" | "operational" | "driver" | "token";

function apiAccess(path: string, method: string): Access {
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
  if (path === "/api/drivers" && (method === "GET" || method === "POST" || method === "DELETE")) return "public";

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

  // Legacy çok amaçlı endpoint artık hiçbir zaman public değildir.
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

  // Unknown read endpoints stay reachable; unknown mutations fail closed.
  return readOnly ? "public" : "admin";
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (publicAsset(path)) return NextResponse.next();

  const adminPage = child(path, "/admin") || child(path, "/dashboard");
  const tvPage = child(path, "/tv") || child(path, "/print");
  const access = path.startsWith("/api/") ? apiAccess(path, req.method) : "public";

  if (!adminPage && !tvPage && (access === "public" || access === "token")) {
    return NextResponse.next();
  }

  const adminOk = await verifySessionToken(
    req.cookies.get(ADMIN_COOKIE)?.value || "",
    "admin",
  );

  if (adminPage || access === "admin") {
    return adminOk ? NextResponse.next() : unauthorized(req, "/admin/login");
  }

  const tvOk = await verifySessionToken(
    req.cookies.get(TV_COOKIE)?.value || "",
    "tv",
  );

  if (tvPage) {
    return tvOk || adminOk
      ? NextResponse.next()
      : unauthorized(req, "/tv/login");
  }

  const driverOk = await verifySessionToken(
    req.cookies.get(DRIVER_COOKIE)?.value || "",
    "driver",
  );

  if (access === "driver") {
    return driverOk || adminOk
      ? NextResponse.next()
      : unauthorized(req, "/driver");
  }

  if (access === "operational") {
    return driverOk || tvOk || adminOk
      ? NextResponse.next()
      : unauthorized(req, "/driver");
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
