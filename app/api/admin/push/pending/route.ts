import { NextResponse } from "next/server";
import { readPendingAdminPushNotifications } from "@/lib/server/admin-push";
import { requireSessionRole } from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const auth = await requireSessionRole(req, "admin");
  if (auth) return auth;

  const items = await readPendingAdminPushNotifications(req);
  return NextResponse.json(
    { ok: true, items },
    {
      headers: {
        "Cache-Control": "private, no-store, no-cache, must-revalidate",
      },
    },
  );
}
