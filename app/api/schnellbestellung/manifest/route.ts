import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const START_URL = "/schnellbestellung/enter?homescreen=1";

export async function GET() {
  return NextResponse.json(
    {
      id: "/schnellbestellung/?app=schnellbestellung",
      name: "Burger Brothers Schnellbestellung",
      short_name: "BB Schnell",
      description:
        "Direkt im Restaurant bestellen und eine Fertig-Benachrichtigung erhalten.",
      start_url: START_URL,
      scope: "/schnellbestellung/",
      display: "standalone",
      display_override: ["standalone", "minimal-ui"],
      background_color: "#0b0f14",
      theme_color: "#0b0f14",
      lang: "de-DE",
      orientation: "portrait-primary",
      icons: [
        {
          src: "/schnell-icon-192.png?v=2",
          sizes: "192x192",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "/schnell-icon-512.png?v=2",
          sizes: "512x512",
          type: "image/png",
          purpose: "any",
        },
      ],
      shortcuts: [
        {
          name: "Schnellbestellung öffnen",
          short_name: "Bestellen",
          url: START_URL,
          icons: [
            {
              src: "/schnell-icon-192.png?v=1",
              sizes: "192x192",
              type: "image/png",
            },
          ],
        },
      ],
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "application/manifest+json; charset=utf-8",
      },
    },
  );
}
