import { NextResponse } from "next/server";
import {
  getSchnellSettings,
  saveSchnellSettings,
} from "@/lib/server/schnellbestellung";
import {
  requireMutationRole,
  requireSessionRole,
} from "@/lib/server/request-security";

export async function GET(req: Request) {
  const auth = await requireSessionRole(req, "admin");
  if (auth) return auth;

  return NextResponse.json(
    {
      ok: true,
      settings: await getSchnellSettings(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function PUT(req: Request) {
  const auth = await requireMutationRole(req, ["admin"]);
  if (auth) return auth;

  const body = await req.json().catch(() => ({}));

  return NextResponse.json({
    ok: true,
    settings: await saveSchnellSettings(body.settings || body),
  });
}
