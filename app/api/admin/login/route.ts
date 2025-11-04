import { NextResponse } from "next/server";

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "1234";
const ADMIN_COOKIE = process.env.ADMIN_COOKIE_NAME || "bb_admin_sess";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const user = String(body?.user ?? "");
    const pass = String(body?.pass ?? "");

    if (user !== ADMIN_USER || pass !== ADMIN_PASS) {
      return NextResponse.json({ ok: false, error: "invalid_credentials" }, { status: 401 });
    }

    const prod = process.env.NODE_ENV === "production";
    const secure = prod; // HTTPS-ready: secure only in prod
    const cookieVal = "ok:" + Date.now();

    const res = NextResponse.json({ ok: true });
    res.cookies.set(ADMIN_COOKIE, cookieVal, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: 60 * 60 * 12, // 12h
    });
    return res;
  } catch (e) {
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
