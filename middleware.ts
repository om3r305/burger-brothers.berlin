import { NextResponse, type NextRequest } from "next/server";

/** Cookie names */
const ADMIN_COOKIE = process.env.ADMIN_COOKIE_NAME || "bb_admin_sess";
const TV_COOKIE = "bb_tv_auth";

/** Protected areas */
const ADMIN_PREFIXES = ["/admin", "/dashboard"];
const TV_PREFIXES = ["/tv"];
const PRINT_PREFIXES = ["/print"];

/** Public paths */
const PUBLIC_PATHS = new Set<string>([
  "/admin/login",
  "/admin/manifest.webmanifest",

  "/tv/login",

  "/favicon.ico",
  "/manifest.webmanifest",
  "/site.webmanifest",
  "/robots.txt",
  "/sitemap.xml",
  "/sw.js",
]);

/** Public prefixes for assets/static files */
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

function isSameOrChild(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

function isPublicPath(pathname: string) {
  if (PUBLIC_PATHS.has(pathname)) return true;

  for (const prefix of PUBLIC_PREFIXES) {
    if (isSameOrChild(pathname, prefix) || pathname.startsWith(prefix)) {
      return true;
    }
  }

  if (
    /\.(png|jpg|jpeg|webp|gif|svg|ico|avif|css|js|map|woff|woff2|ttf|otf)$/i.test(
      pathname,
    )
  ) {
    return true;
  }

  return false;
}

function isAdminRoute(pathname: string) {
  return ADMIN_PREFIXES.some((prefix) => isSameOrChild(pathname, prefix));
}

function isTvRoute(pathname: string) {
  return TV_PREFIXES.some((prefix) => isSameOrChild(pathname, prefix));
}

function isPrintRoute(pathname: string) {
  return PRINT_PREFIXES.some((prefix) => isSameOrChild(pathname, prefix));
}

function hasAdminSession(req: NextRequest) {
  const value = req.cookies.get(ADMIN_COOKIE)?.value || "";
  return value.startsWith("ok:");
}

function hasTvSession(req: NextRequest) {
  const value = req.cookies.get(TV_COOKIE)?.value || "";
  return value === "1";
}

function redirectWithNext(req: NextRequest, pathname: string) {
  const url = req.nextUrl.clone();
  const current = req.nextUrl.pathname + (req.nextUrl.search || "");

  url.pathname = pathname;
  url.search = "";

  if (current && current !== pathname) {
    url.searchParams.set("from", current);
    url.searchParams.set("next", current);
  }

  return NextResponse.redirect(url);
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const adminOk = hasAdminSession(req);
  const tvOk = hasTvSession(req);

  /*
    ADMIN:
    - Sadece admin cookie kabul edilir.
    - TV cookie admin tarafına yetki vermez.
  */
  if (isAdminRoute(pathname)) {
    if (!adminOk) {
      return redirectWithNext(req, "/admin/login");
    }

    return NextResponse.next();
  }

  /*
    TV:
    - TV PIN cookie kabul edilir.
    - Admin cookie de kabul edilir çünkü admin tam yetkili cihazda TV ekranını açabilir.
    - Ama TV cookie admin tarafını açamaz.
  */
  if (isTvRoute(pathname)) {
    if (!tvOk && !adminOk) {
      return redirectWithNext(req, "/tv/login");
    }

    return NextResponse.next();
  }

  /*
    PRINT:
    - Mutfak/TV ekranı print sayfalarını açabilir.
    - Admin de açabilir.
  */
  if (isPrintRoute(pathname)) {
    if (!tvOk && !adminOk) {
      return redirectWithNext(req, "/admin/login");
    }

    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  /*
    API rotalarını burada bilinçli olarak dışarıda bırakıyoruz.
    API güvenliği ilgili route içinde yapılmalı.
    Sayfa koruması burada yapılır.
  */
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};