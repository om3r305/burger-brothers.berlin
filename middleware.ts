// middleware.ts
import { NextResponse, NextRequest } from "next/server";

/** Admin ve TV çerez adları */
const ADMIN_COOKIE = process.env.ADMIN_COOKIE_NAME || "bb_admin_sess";
const TV_COOKIE = "bb_tv_auth";

/** Korumalı alanlar */
const ADMIN_PREFIXES = ["/admin", "/dashboard"];
const TV_PREFIXES = ["/tv", "/print"];

/** Public yollar (middleware check atlanır) */
const PUBLIC_PATHS = new Set<string>([
  "/admin/login",
  "/admin/manifest.webmanifest",  // ← eklendi: admin PWA manifest public olmalı
  "/api/admin/login",
  "/api/admin/logout",

  // TV login akışı
  "/tv/login",
  "/api/tv/login",
  "/api/tv/logout",

  "/_next",
  "/favicon.ico",
]);

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Next statikleri ve genel public yollar serbest
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/static") ||
    pathname.startsWith("/images") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }
  for (const pub of PUBLIC_PATHS) {
    if (pathname === pub || pathname.startsWith(pub + "/")) {
      return NextResponse.next();
    }
  }

  // Çerezleri oku
  const adminSess = req.cookies.get(ADMIN_COOKIE)?.value || "";
  const tvSess = req.cookies.get(TV_COOKIE)?.value || "";

  // ───────────────── ADMIN KORUMASI ─────────────────
  const isAdminRoute = ADMIN_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
  if (isAdminRoute) {
    const ok = adminSess.startsWith("ok:");
    if (!ok) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin/login";
      // ← query’yi koru (önceden sadece pathname idi)
      url.searchParams.set("next", pathname + (search || ""));
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // ───────────────── TV KORUMASI ─────────────────
  const isTVRoute = TV_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
  if (isTVRoute) {
    // TV'ye giriş: ya admin oturumu ya da TV PIN cookie kabul
    const ok = adminSess.startsWith("ok:") || tvSess === "1";

    if (!ok) {
      // /tv altı için doğrudan TV login'e
      if (pathname === "/tv" || pathname.startsWith("/tv/")) {
        const url = req.nextUrl.clone();
        url.pathname = "/tv/login";
        url.searchParams.set("next", pathname + (search || "")); // ← query’yi koru
        return NextResponse.redirect(url);
      }
      // /print sayfaları hem admin hem TV tarafından kullanılabilir
      // ikisi de yoksa admin login'e yönlendir
      const url = req.nextUrl.clone();
      url.pathname = "/admin/login";
      url.searchParams.set("next", pathname + (search || "")); // ← query’yi koru
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // Diğer tüm yollar serbest
  return NextResponse.next();
}

/**
 * Not: API rotaları bu matcher dışında tutuluyor (performans ve
 * login endpoint'lerini serbest bırakmak için).
 */
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
