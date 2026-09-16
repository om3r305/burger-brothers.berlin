import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Burger Brothers Preiskasse",
  applicationName: "Burger Brothers Preiskasse",
  description: "Burger Brothers Berlin Preiskasse",
  manifest: "/manifest-kasa.webmanifest",
  icons: {
    icon: "/schnell-icon-192.png",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "Preiskasse",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#090909",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function KasaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
