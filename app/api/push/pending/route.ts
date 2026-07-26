import { NextResponse } from "next/server";
import { readPendingGeneralNotifications } from "@/lib/server/general-push";
import { enforceRateLimit } from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const rate = await enforceRateLimit(req, "push:pending", 180, 10 * 60_000);
  if (rate) return rate;

  const events = await readPendingGeneralNotifications(req).catch((error) => {
    console.error("[push/pending]", error);
    return [];
  });

  return NextResponse.json(
    { ok: true, events },
    {
      headers: {
        "Cache-Control": "private, no-store, no-cache, must-revalidate",
      },
    },
  );
}
