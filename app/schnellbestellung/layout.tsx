import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Schnellbestellung | Burger Brothers Berlin",
  description: "Direkt im Restaurant bestellen.",
  applicationName: "Burger Brothers Schnellbestellung",
  manifest: "/manifest-schnellbestellung.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Burger Brothers",
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
    "apple-mobile-web-app-title": "Burger Brothers",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
  },
};

export default function SchnellbestellungLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
