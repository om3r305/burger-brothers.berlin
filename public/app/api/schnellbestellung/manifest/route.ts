import { NextResponse } from "next/server";
import {
  getSchnellSettings,
  verifyAccessToken,
} from "@/lib/server/schnellbestellung";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function manifestResponse(startUrl: string) {
  return NextResponse.json(
    {
      id: "/schnellbestellung/?app=schnellbestellung",
      name: "Burger Brothers Schnellbestellung",
      short_name: "Burger Brothers",
      description:
        "Direkt im Restaurant bestellen und eine Fertig-Benachrichtigung erhalten.",
      start_url: startUrl,
      scope: "/schnellbestellung/",
      display: "standalone",
      display_override: ["standalone", "minimal-ui"],
      background_color: "#0b0f14",
      theme_color: "#0b0f14",
      lang: "de-DE",
      orientation: "portrait-primary",
      icons: [
        {
          src: "/schnell-icon-192.png?v=1",
          sizes: "192x192",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "/schnell-icon-512.png?v=1",
          sizes: "512x512",
          type: "image/png",
          purpose: "any",
        },
      ],
      shortcuts: [
        {
          name: "Schnellbestellung öffnen",
          short_name: "Bestellen",
          url: startUrl,
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

export async function GET(req: Request) {
  const settings = await getSchnellSettings({ includeTvPause: false });
  const url = new URL(req.url);
  const token = url.searchParams.get("t")?.trim() || "";
  const validToken = token ? verifyAccessToken(token, settings) : null;

  const search = new URLSearchParams({ homescreen: "1" });
  if (settings.iosHomeScreenFlowEnabled && validToken) {
    search.set("t", token);
  }

  return manifestResponse(`/schnellbestellung/enter?${search.toString()}`);
}
