import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { createSessionToken } from "@/lib/server/session";
import { enforceRateLimit } from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const ADMIN_COOKIE = process.env.ADMIN_COOKIE_NAME || "bb_admin_sess";

const headers = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

function isProd() {
  return process.env.NODE_ENV === "production";
}

function getAdminUser() {
  return process.env.ADMIN_USER || (isProd() ? "" : "admin");
}

function getAdminPass() {
  return process.env.ADMIN_PASS || (isProd() ? "" : "1234");
}

function safeEqual(a: string, b: string) {
  try {
    const aa = Buffer.from(a);
    const bb = Buffer.from(b);

    if (aa.length !== bb.length) return false;

    return timingSafeEqual(aa, bb);
  } catch {
    return false;
  }
}

function json(payload: Record<string, any>, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers,
  });
}

export async function POST(req: Request) {
  const rateError = enforceRateLimit(req, "login:admin", 5, 15 * 60_000);
  if (rateError) return rateError;

  try {
    const adminUser = getAdminUser();
    const adminPass = getAdminPass();

    if (!adminUser || !adminPass) {
      return json(
        {
          ok: false,
          error: "admin_credentials_not_configured",
        },
        500,
      );
    }

    const body = await req.json().catch(() => ({}));
    const user = String(body?.user ?? "").trim();
    const pass = String(body?.pass ?? "");

    if (!safeEqual(user, adminUser) || !safeEqual(pass, adminPass)) {
      return json(
        {
          ok: false,
          error: "invalid_credentials",
        },
        401,
      );
    }

    const res = json({ ok: true });

    const sessionToken = await createSessionToken("admin", 60 * 60 * 12);

    res.cookies.set(ADMIN_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd(),
      path: "/",
      maxAge: 60 * 60 * 12,
    });

    return res;
  } catch {
    return json(
      {
        ok: false,
        error: "server_error",
      },
      500,
    );
  }
}