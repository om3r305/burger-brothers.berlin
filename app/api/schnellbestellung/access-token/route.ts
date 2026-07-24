import { NextResponse } from "next/server";
import {
  createAccessToken,
  getSchnellSettings,
} from "@/lib/server/schnellbestellung";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function unavailable(error: string, status = 503) {
  return NextResponse.json(
    {
      ok: false,
      error,
      retryAfterSeconds: 15,
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": "15",
      },
    },
  );
}

export async function GET() {
  try {
    const settings = await getSchnellSettings();

    if (!settings.enabled) {
      return unavailable("disabled");
    }

    if (settings.paused) {
      return unavailable("paused");
    }

    const token = createAccessToken(settings);

    return NextResponse.json(
      {
        ok: true,
        token,
        expiresIn: settings.qrTtlMinutes * 60,
        issuedAt: Date.now(),
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    const code =
      error instanceof Error && error.message === "SESSION_SECRET_MISSING"
        ? "configuration_missing"
        : "token_unavailable";

    console.error("[schnellbestellung/access-token] token creation failed", {
      code,
      error: error instanceof Error ? error.message : String(error),
    });

    return unavailable(code);
  }
}
