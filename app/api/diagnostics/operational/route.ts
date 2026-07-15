import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function configured(...names: string[]) {
  return names.some((name) => Boolean(String(process.env[name] || "").trim()));
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);

    return NextResponse.json(
      {
        ok: true,
        now: new Date().toISOString(),
        host:
          request.headers.get("x-forwarded-host") ||
          request.headers.get("host") ||
          "",
        pathname: url.pathname,
        requestedRoute: url.searchParams.get("route") || "",
        userAgent: request.headers.get("user-agent") || "",
        cookies: {
          bb_tv_auth: Boolean(request.cookies.get("bb_tv_auth")?.value),
          bb_tv_sess: Boolean(request.cookies.get("bb_tv_sess")?.value),
          bb_admin_sess: Boolean(
            request.cookies.get(
              process.env.ADMIN_COOKIE_NAME || "bb_admin_sess",
            )?.value,
          ),
        },
        environment: {
          tvPinConfigured: configured(
            "TV_PIN",
            "NEXT_PUBLIC_TV_PIN",
            "BB_TV_PIN",
          ),
          driverPinConfigured: configured(
            "DRIVER_PIN",
            "NEXT_PUBLIC_DRIVER_PIN",
            "BB_DRIVER_PIN",
          ),
          driverPasswordConfigured: configured(
            "DRIVER_PASSWORD",
            "NEXT_PUBLIC_DRIVER_PASSWORD",
            "BB_DRIVER_PASSWORD",
          ),
          nodeEnv: process.env.NODE_ENV || "",
        },
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : String(error || "DIAGNOSTIC_ERROR"),
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      },
    );
  }
}
