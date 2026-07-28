import { NextRequest, NextResponse } from "next/server";
import { expireAbandonedPaymentSessions } from "@/lib/server/payment-expiry";
import { secretMatches } from "@/lib/server/request-security";
import { cleanupExpiredRewardPhotos } from "@/lib/server/reward-cleanup";
import { processDueAutomaticNotifications } from "@/lib/server/automatic-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
      { status: 401 },
    );
  }

  const result = await expireAbandonedPaymentSessions(req.url);
  const notifications = await processDueAutomaticNotifications().catch((error) => {
    console.error("[cron/expire-payments] scheduled notification dispatch failed", error);
    return { processed: 0 };
  });
  const rewardCleanup = await cleanupExpiredRewardPhotos().catch((error) => {
    console.error("[cron/expire-payments] reward cleanup failed", error);
    return { scanned: 0, deleted: 0 };
  });
  return NextResponse.json(
    { ok: true, ...result, notifications, rewardCleanup },
    { headers: { "Cache-Control": "no-store" } },
  );
}
