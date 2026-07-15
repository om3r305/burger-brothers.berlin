// app/tv/layout.tsx
export const metadata = {
  title: "Burger Brothers • TV",
  description: "Burger Brothers – Küchenmonitor",
  manifest: "/manifest-tv.webmanifest?v=5",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Burger TV",
  },
};

export default function TVLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bb-operational-route bb-operational-route--tv">
      <link rel="manifest" href="/manifest-tv.webmanifest?v=6" />
      <style
        dangerouslySetInnerHTML={{
          __html: `
            footer { display: none !important; }

            /*
             * iOS Safari / Home-Screen uygulamasında route giriş animasyonu
             * bazen ilk opacity değerinde kalabiliyor. Bu kural sadece /tv
             * layout'u render edildiği sürece bulunur.
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
            .bb-operational-route--tv {
              position: relative;
              min-height: 100svh;
              width: 100%;
              opacity: 1 !important;
              visibility: visible !important;
            }
          `,
        }}
      />
      {children}
    </div>
  );
}
