// app/layout.tsx
import "./globals.css";
import { Inter } from "next/font/google";
import Footer from "@/components/Footer";
import SettingsSync from "./SettingsSync";
import ProductsSync from "./ProductsSync";
import DriversSync from "./DriversSync";
import OrdersSync from "./OrdersSync";
import { LS_SETTINGS } from "@/lib/settings";
import AnnouncementsClient from "@/components/AnnouncementsClient"; // ← DUYURU

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
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: "/favicon.ico",
    apple: [{ url: "/apple-touch-icon.png?v=5", sizes: "180x180" }],
  },
} as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body
        className={`${inter.variable} bg-stone-950 text-stone-100 min-h-screen`}
        style={{
          backgroundColor: "#000",
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

  // admin sayfalarını kapatma
  function isAdmin() {
    try {
      var p = location.pathname || "/";
      return p === "/admin" || p.startsWith("/admin/");
    } catch (_) { return false; }
  }
  if (isAdmin()) return;

  // LOGO seçici (mutlak URL + sağlam fallback)
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

      // /logo.png default'u veya boş değerler fallback'e düşsün
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
      .replace(/'/g, "\\'");

    // LOGO büyüklüğü (gölgesiz)
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
      if (closed) makeOverlay(msg, logo); else removeOverlay();
    } catch (_) {}
  }

  // İlk değerlendirme
  evalState();

  // Settings değişince canlı güncelle
  window.addEventListener("bb_settings_changed", function (ev) {
    try {
      var s = (ev && ev.detail) || {};
      var closed = !!(s.site && s.site.closed);
      var msg = (s.site && s.site.message) || "";
      var logo = pickLogo(s);
      if (closed) makeOverlay(msg, logo); else removeOverlay();
    } catch (_) {}
  });

  // Başka sekmeden değişirse
  window.addEventListener("storage", function (ev) {
    if (ev && ev.key === KEY) evalState();
  });
})();`,
          }}
        />

        {/* 🔁 Server → localStorage ayar senkronu (tüm rotalarda) */}
        <SettingsSync />

        {/* App-shell */}
        <main className="app-shell min-w-0">{children}</main>

        {/* ↓ Duyuru bottom-sheet/sağ-alt (Admin sayfasında otomatik gizlenir) */}
        <AnnouncementsClient />

        {/* Alt CTA boşluğu (yalnız mobil) */}
        <div aria-hidden className="h-[calc(env(safe-area-inset-bottom)+96px)] sm:hidden" />

        <Footer />

        {/* Merkezi senkronlar (tek kez render) */}
        <ProductsSync />
        <DriversSync />
        <OrdersSync />
      </body>
    </html>
  );
}
