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
    <div suppressHydrationWarning>
      {/* /driver altında global footer'ı gizle (SSR'da gelir → hydration sorunu olmaz) */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            footer { display: none !important; }
          `,
        }}
      />

      {/* iOS & PWA: driver'a özel manifest linki */}
      <link rel="manifest" href="/manifest-driver.webmanifest?v=5" />

      {children}
    </div>
  );
}
