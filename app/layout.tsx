// app/layout.tsx
import "./globals.css";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import Footer from "@/components/Footer";
import SettingsSync from "./SettingsSync";
import ThemeClient from "./theme-client";
import ProductsSync from "./ProductsSync";
import { LS_SETTINGS } from "@/lib/settings";
import AnalyticsPing from "@/components/AnalyticsPing";
import AppRouteTransition from "@/components/AppRouteTransition";
import CatalogProvider from "@/components/catalog/CatalogProvider";

/* 🔧 SSG yerine runtime render (prerender hatalarını engelle) */
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

/** Tarayıcı tema rengi + viewport (PWA/iOS için ideal) */
export const viewport = {
  themeColor: "#0b0f14",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
} as const;

/** Global meta */
export const metadata = {
  title: "Burger Brothers Berlin",
  description: "Premium Burger Experience.",
  applicationName: "Burger Brothers Berlin",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Burger Brothers",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: [{ url: "/apple-touch-icon.png?v=5", sizes: "180x180" }],
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-title": "Burger Brothers",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
  },
} as const;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") || undefined;

  return (
    <html
      lang="de"
      suppressHydrationWarning
      data-bb-theme="classic"
      data-bb-effects="0"
      data-bb-motion="1"
      data-bb-snow="0"
    >
      <body
        className={`${inter.variable} bg-stone-950 text-stone-100 min-h-screen`}
        style={{
          backgroundColor: "var(--bb-page-bg, #000)",
          WebkitTapHighlightColor: "transparent",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {/* 🔐 Bakım Modu – ADMIN hariç tüm sayfaları kapatır + LOGO */}
        <script
          id="bb-maintenance-gate"
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `
(function () {
  var KEY = ${JSON.stringify(LS_SETTINGS)};
  var overlayId = "bb-maintenance-overlay";

  function isAdmin() {
    try {
      var p = location.pathname || "/";
      return p === "/admin" || p.startsWith("/admin/");
    } catch (_) { return false; }
  }
  if (isAdmin()) return;

  function toAbs(u) {
    try {
      if (!u) return "";
      if (/^https?:\\/\\//i.test(u)) return u;
      if (u[0] !== "/") u = "/" + u;
      return location.origin + u;
    } catch (_) { return ""; }
  }

  function pickLogo(s) {
    try {
      var theme = s && s.theme;
      var active = theme && (theme.active || "classic");
      var cand =
        (theme && theme.logos && theme.logos[active]) ||
        (s && s.printing && s.printing.logoUrl) ||
        "";

      if (!cand || cand === "/logo.png" || cand === "logo.png") {
        cand = "/logo-burger-brothers.png";
      }

      return toAbs(cand);
    } catch (_) {
      return toAbs("/logo-burger-brothers.png");
    }
  }

  function makeOverlay(msg, logoUrl) {
    if (document.getElementById(overlayId)) return;

    var wrap = document.createElement("div");
    wrap.id = overlayId;
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.style.position = "fixed";
    wrap.style.inset = "0";
    wrap.style.zIndex = "2147483647";
    wrap.style.background = "#000";
    wrap.style.display = "grid";
    wrap.style.placeItems = "center";
    wrap.style.padding = "24px";

    var content = document.createElement("div");
    content.style.textAlign = "center";
    content.style.maxWidth = "760px";

    if (logoUrl) {
      var logo = document.createElement("img");
      logo.alt = "Logo";
      logo.src = logoUrl;
      logo.style.width = "140px";
      logo.style.height = "140px";
      logo.style.objectFit = "contain";
      logo.style.borderRadius = "24px";
      logo.style.display = "block";
      logo.style.margin = "0 auto 20px auto";
      logo.addEventListener("error", function () {
        logo.src = location.origin + "/logo-burger-brothers.png";
      }, { once: true });
      content.appendChild(logo);
    }

    var title = document.createElement("div");
    title.style.fontWeight = "700";
    title.style.fontSize = "22px";
    title.style.lineHeight = "1.1";
    title.style.marginBottom = "8px";
    title.style.color = "#fff";
    title.textContent = "Wartungsmodus";
    content.appendChild(title);

    var message = document.createElement("div");
    message.style.color = "#d6d3d1";
    message.style.fontSize = "14px";
    message.style.letterSpacing = ".2px";
    message.style.whiteSpace = "pre-line";
    message.textContent = String(msg || "");
    content.appendChild(message);

    wrap.appendChild(content);
    document.body.appendChild(wrap);
  }

  function removeOverlay() {
    var el = document.getElementById(overlayId);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function evalState() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) { removeOverlay(); return; }

      var s = JSON.parse(raw) || {};
      var closed = !!(s.site && s.site.closed);
      var msg = (s.site && s.site.message) || "";
      var logo = pickLogo(s);

      if (closed) makeOverlay(msg, logo);
      else removeOverlay();
    } catch (_) {}
  }

  evalState();

  window.addEventListener("bb_settings_changed", function (ev) {
    try {
      var s = (ev && ev.detail) || {};
      var closed = !!(s.site && s.site.closed);
      var msg = (s.site && s.site.message) || "";
      var logo = pickLogo(s);

      if (closed) makeOverlay(msg, logo);
      else removeOverlay();
    } catch (_) {}
  });

  window.addEventListener("storage", function (ev) {
    if (ev && ev.key === KEY) evalState();
  });
})();`,
          }}
        />

        {/* Ana giriş sayfasında mobil alt boşluğu kapatır, diğer sayfalarda korur */}
        <style
          id="bb-mobile-footer-gap-style"
          dangerouslySetInnerHTML={{
            __html: `
.bb-mobile-footer-gap {
  height: calc(env(safe-area-inset-bottom) + 96px);
}

@media (min-width: 640px) {
  .bb-mobile-footer-gap {
    display: none;
  }
}

body:has(#bb-landing-page) .bb-mobile-footer-gap {
  display: none;
}
`,
          }}
        />

        {/* Uygulama hissi veren merkezi route geçiş katmanı */}
        <AppRouteTransition />

        {/* Öffentliche Besucher-Statistik für Admin > Statistiken */}
        <AnalyticsPing />

        {/* 🔁 Server → localStorage ayar senkronu */}
        <SettingsSync />

        {/* 🎨 DB / localStorage temasını müşteri tarafına uygular */}
        <ThemeClient />

        {/* Merkezi katalog/cache katmanı — DB ana kaynak olarak kalır */}
        <CatalogProvider>
          {/* App-shell */}
          <main className="app-shell min-w-0">{children}</main>
        </CatalogProvider>

        {/*
          Kampanya / broşür artık global layout'ta gösterilmiyor.
          Büyük kampanya pop-up sadece app/page.tsx ana giriş sayfasında çalışır.
        */}

        {/* Alt CTA boşluğu (mobilde menü/checkout için, ana giriş sayfasında CSS ile kapanır) */}
        <div aria-hidden className="bb-mobile-footer-gap" />

        <Footer />

        {/* Merkezi senkronlar */}
        <ProductsSync />
      </body>
    </html>
  );
}