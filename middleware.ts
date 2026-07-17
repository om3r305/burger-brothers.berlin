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

function publicPath(path: string) {
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
  url.searchParams.set(
    "next",
    req.nextUrl.pathname + req.nextUrl.search,
  );
  return NextResponse.redirect(url);
}

function orderApiAccess(path: string, method: string, req: NextRequest) {
  if (path === "/api/orders/list") return "operational" as const;
  if (path === "/api/orders/claim") return "driver" as const;
  if (path === "/api/orders/status") return "operational" as const;

  if (path === "/api/orders") {
    if (method === "GET" && req.nextUrl.searchParams.get("id")) {
      return "public" as const;
    }
    if (method === "POST") return "public" as const;
    return "operational" as const;
  }

  return "public" as const;
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (publicPath(path)) return NextResponse.next();

  const adminRequired =
    child(path, "/admin") ||
    child(path, "/dashboard") ||
    child(path, "/api/admin");
  const tvRequired =
    child(path, "/tv") ||
    child(path, "/print") ||
    child(path, "/api/tv");
  const orderAccess = orderApiAccess(path, req.method, req);

  if (!adminRequired && !tvRequired && orderAccess === "public") {
    return NextResponse.next();
  }

  const adminOk = await verifySessionToken(
    req.cookies.get(ADMIN_COOKIE)?.value || "",
    "admin",
  );

  if (adminRequired) {
    return adminOk
      ? NextResponse.next()
      : unauthorized(req, "/admin/login");
  }

  const tvOk = await verifySessionToken(
    req.cookies.get(TV_COOKIE)?.value || "",
    "tv",
  );

  if (tvRequired) {
    return tvOk || adminOk
      ? NextResponse.next()
      : unauthorized(req, "/tv/login");
  }

  const driverOk = await verifySessionToken(
    req.cookies.get(DRIVER_COOKIE)?.value || "",
    "driver",
  );

  if (orderAccess === "driver") {
    return driverOk || adminOk
      ? NextResponse.next()
      : unauthorized(req, "/driver");
  }

  if (orderAccess === "operational") {
    return driverOk || tvOk || adminOk
      ? NextResponse.next()
      : unauthorized(req, "/driver");
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
