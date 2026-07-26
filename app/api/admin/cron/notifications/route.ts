import { NextRequest, NextResponse } from "next/server";
import { processDueAutomaticNotifications } from "@/lib/server/automatic-notifications";
import { secretMatches } from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function authorized(req: NextRequest) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  if (!secret) return process.env.NODE_ENV !== "production" && !process.env.VERCEL;

  const bearer = String(req.headers.get("authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  return secretMatches(bearer, secret);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED_CRON_REQUEST" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const result = await processDueAutomaticNotifications();
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[cron/notifications] dispatch failed", error);
    return NextResponse.json(
      { ok: false, error: "NOTIFICATION_DISPATCH_FAILED" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
