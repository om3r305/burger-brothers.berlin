import { NextResponse } from "next/server";
import {
  getSchnellSettings,
  isAndroidUserAgent,
  SCHNELL_COOKIE,
  schnellSessionIsInstalledApp,
  verifySessionToken,
} from "@/lib/server/schnellbestellung";
import { readRequestCookie } from "@/lib/server/request-security";

export async function GET(req: Request) {
  const settings = await getSchnellSettings();
  const session = verifySessionToken(
    readRequestCookie(req, SCHNELL_COOKIE),
    settings,
  );

  return NextResponse.json(
    {
      ok: Boolean(session),
      enabled: settings.enabled,
      paused: settings.paused,
      expiresAt: session?.exp || null,
      recheckRequired:
        Boolean(session) &&
        settings.locationCheckEnabled &&
        Date.now() - Number(session?.locAt) > settings.recheckMinutes * 60_000,
      installedApp: schnellSessionIsInstalledApp(session),
      androidInstallRequired:
        isAndroidUserAgent(req.headers.get("user-agent")) &&
        !schnellSessionIsInstalledApp(session),
      locationCheckEnabled: settings.locationCheckEnabled,
      iosHomeScreenFlowEnabled: settings.iosHomeScreenFlowEnabled,
      backgroundReadyPushEnabled:
        settings.backgroundReadyPushEnabled &&
        readRequestCookie(req, "bb_schnell_push_skip") !== "1",
      payments: {
        cash: settings.cashEnabled,
        online: settings.onlineEnabled,
        split: settings.splitEnabled,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
