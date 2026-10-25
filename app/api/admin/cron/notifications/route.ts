import { flushNativeSchnellNotifications } from "@/lib/server/native-schnell-push";
import { flushNativeDriverNotifications } from "@/lib/server/native-driver-push";
import { NextRequest, NextResponse } from "next/server";
import { processDueAutomaticNotifications } from "@/lib/server/automatic-notifications";
import { secretMatches } from "@/lib/server/request-security";
import { cleanupExpiredRewardPhotos } from "@/lib/server/reward-cleanup";

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
    const [result, rewardCleanup, driverNotifications, schnellNotifications] = await Promise.all([
      processDueAutomaticNotifications(),
      cleanupExpiredRewardPhotos().catch((cleanupError) => {
        console.error("[cron/notifications] reward cleanup failed", cleanupError);
        return { scanned: 0, deleted: 0 };
      }),
      flushNativeDriverNotifications(),
      flushNativeSchnellNotifications(),
    ]);
    return NextResponse.json(
      { ok: true, ...result, rewardCleanup, driverNotifications, schnellNotifications },
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
