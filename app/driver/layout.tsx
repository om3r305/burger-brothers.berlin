// ❗️BU DOSYAYA "use client" KOYMA — server component olmalı.
export const metadata = {
  title: "Kurier",
  description: "Burger Brothers – Fahrer",
  // route-bazlı manifest
  manifest: "/manifest-driver.webmanifest?v=5",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Kurier",
  },
};

export default function DriverLayout({ children }: { children: React.ReactNode }) {
  return (
    // Sadece /driver altında geçerli wrapper
    <div
      className="bb-operational-route bb-operational-route--driver"
      suppressHydrationWarning
    >
      {/* /driver altında global footer'ı gizle ve iOS görünürlük kilidini kaldır */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            footer { display: none !important; }

            /*
             * iOS Safari / Home-Screen uygulamasında route giriş animasyonu
             * bazen ilk opacity değerinde kalabiliyor. Bu kural yalnızca
             * /driver layout'u render edildiği sürece bulunur.
             */
            .bb-route-view {
              opacity: 1 !important;
              visibility: visible !important;
              animation: none !important;
              transition: none !important;
              pointer-events: auto !important;
              z-index: auto !important;
            }

            html.bb-route-pending .bb-route-view,
            html.bb-route-arrived .bb-route-view {
              opacity: 1 !important;
              visibility: visible !important;
              pointer-events: auto !important;
            }

            .bb-operational-route,
            .bb-operational-route--driver {
              position: relative;
              min-height: 100svh;
              width: 100%;
              opacity: 1 !important;
              visibility: visible !important;
            }
          `,
        }}
      />

      {/* iOS & PWA: driver'a özel manifest linki */}
      <link rel="manifest" href="/manifest-driver.webmanifest?v=6" />

      {children}
    </div>
  );
}
