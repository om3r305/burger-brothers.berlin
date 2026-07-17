import { NextResponse } from "next/server";
import { requireAnySessionRole } from "@/lib/server/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const authError = await requireAnySessionRole(request, ["admin", "tv"]);
  if (authError) return authError;

  return NextResponse.json(
    {
      ok: true,
      service: "burger-brothers-operational",
      now: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    },
  );
}
