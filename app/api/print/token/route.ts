import { NextResponse } from "next/server";
import {
  enforceRateLimit,
  requireAnySessionRole,
} from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const authError = await requireAnySessionRole(req, ["admin", "tv"]);
  if (authError) return authError;

  const rateError = await enforceRateLimit(req, "print:proxy-token", 20, 60_000);
  if (rateError) return rateError;

  const token = String(process.env.PRINT_PROXY_TOKEN || "").trim();

  if (token.length < 32) {
    return NextResponse.json(
      { ok: false, error: "print_proxy_not_configured" },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  return NextResponse.json(
    { ok: true, token },
    {
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}
