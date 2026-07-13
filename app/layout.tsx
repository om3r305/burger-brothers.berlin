// app/layout.tsx
import "./globals.css";
import { Inter } from "next/font/google";
import Footer from "@/components/Footer";
import SettingsSync from "./SettingsSync";
import ThemeClient from "./theme-client";
import ProductsSync from "./ProductsSync";
import DriversSync from "./DriversSync";
import { LS_SETTINGS } from "@/lib/settings";
import AnalyticsPing from "@/components/AnalyticsPing";

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" suppressHydrationWarning data-bb-theme="classic" data-bb-effects="0" data-bb-motion="1" data-bb-snow="0">
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

    var fallback = (location.origin + "/logo-burger-brothers.png")
      .replace(/"/g, '&quot;')
      .replace(/'/g, "\\\\'");

    var logoHtml = logoUrl
      ? '<img src="' + logoUrl +
        '" alt="Logo" onerror="this.onerror=null;this.src=\\'' + fallback + '\\'" ' +
        'style="width:140px;height:140px;object-fit:contain;border-radius:24px;display:block;margin:0 auto 20px auto;" />'
      : "";

    wrap.innerHTML =
      '<div style="text-align:center;max-width:760px">' +
        logoHtml +
        '<div style="font-weight:700;font-size:22px;line-height:1.1;margin-bottom:8px;color:#fff">Wartungsmodus</div>' +
        '<div style="color:#d6d3d1;font-size:14px;letter-spacing:.2px;white-space:pre-line">' + (msg || "") + "</div>" +
      "</div>";

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

        {/* Öffentliche Besucher-Statistik für Admin > Statistiken */}
        <AnalyticsPing />

        {/* 🔁 Server → localStorage ayar senkronu */}
        <SettingsSync />

        {/* 🎨 DB / localStorage temasını müşteri tarafına uygular */}
        <ThemeClient />

        {/* App-shell */}
        <main className="app-shell min-w-0">{children}</main>

        {/* 
          Kampanya / broşür artık global layout'ta gösterilmiyor.
          Büyük kampanya pop-up sadece app/page.tsx ana giriş sayfasında çalışır.
        */}

        {/* Alt CTA boşluğu (mobilde menü/checkout için, ana giriş sayfasında CSS ile kapanır) */}
        <div aria-hidden className="bb-mobile-footer-gap" />

        <Footer />

        {/* Merkezi senkronlar */}
        <ProductsSync />
        <DriversSync />
      </body>
    </html>
  );
}
