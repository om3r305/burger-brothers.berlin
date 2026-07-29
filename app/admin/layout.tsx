import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import AdminShell from "./AdminShell";

export const metadata: Metadata = {
  title: {
    default: "Burger Brothers • Admin",
    template: "%s • Burger Admin",
  },
  description: "Burger Brothers Berlin yönetim paneli",
  applicationName: "Burger Brothers Admin",
  manifest: "/admin/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Burger Admin",
  },
  icons: {
    icon: [
      {
        url: "/admin/icons/admin-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        url: "/admin/icons/admin-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: "/admin/icons/admin-apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-title": "Burger Admin",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#070707",
  colorScheme: "dark",
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
