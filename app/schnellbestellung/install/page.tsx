import type { Metadata } from "next";
import SchnellInstallClient from "@/components/schnellbestellung/SchnellInstallClient";

export const metadata: Metadata = {
  title: "BB Schnell installieren | Burger Brothers Berlin",
  description:
    "Burger Brothers Schnellbestellung als eigene Android-App installieren.",
  applicationName: "Burger Brothers Schnellbestellung",
  manifest: "/api/schnellbestellung/manifest?v=4",
  icons: {
    icon: [
      {
        url: "/schnell-icon-192.png?v=2",
        sizes: "192x192",
        type: "image/png",
      },
      {
        url: "/schnell-icon-512.png?v=2",
        sizes: "512x512",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: "/schnell-icon-180.png?v=2",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-title": "BB Schnell",
  },
};

export default function SchnellInstallPage() {
  return <SchnellInstallClient />;
}
