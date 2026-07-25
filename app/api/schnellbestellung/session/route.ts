import { NextResponse } from "next/server";
import {
  getSchnellSettings,
  SCHNELL_COOKIE,
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
      locationCheckEnabled: settings.locationCheckEnabled,
      payments: {
        cash: settings.cashEnabled,
        online: settings.onlineEnabled,
        split: settings.splitEnabled,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
