import type { Metadata } from "next";
import Script from "next/script";

export const metadata: Metadata = {
  title: "Schnellbestellung | Burger Brothers Berlin",
  description: "Direkt im Restaurant bestellen.",
  applicationName: "Burger Brothers Schnellbestellung",
  manifest: "/api/schnellbestellung/manifest?v=4",
  appleWebApp: {
    capable: true,
    title: "BB Schnell",
    statusBarStyle: "black-translucent",
  },
  icons: {
    apple: [
      {
        url: "/schnell-icon-180.png?v=1",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-title": "BB Schnell",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
  },
};

const androidInstallCapture = `
(() => {
  if (window.__bbAndroidInstallCaptureReady) return;
  window.__bbAndroidInstallCaptureReady = true;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    window.__bbAndroidInstallPrompt = event;
    window.dispatchEvent(new Event("bb:android-install-ready"));
  });

  window.addEventListener("appinstalled", () => {
    window.__bbAndroidInstallPrompt = null;
  });
})();
`;

export default function SchnellbestellungLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Script
        id="bb-android-install-capture"
        strategy="beforeInteractive"
        dangerouslySetInnerHTML={{ __html: androidInstallCapture }}
      />
      {children}
    </>
  );
}
