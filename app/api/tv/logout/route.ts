// app/api/tv/logout/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const COOKIES_TO_CLEAR = [
  "bb_tv_auth",
  "bb_tv_ui",

  // legacy/eski isimler
  "bb_tv_sess",
];

function clearCookie(res: NextResponse, name: string, httpOnly: boolean) {
  res.cookies.set(name, "", {
    httpOnly,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
}

function clearTvCookies(res: NextResponse) {
  for (const name of COOKIES_TO_CLEAR) {
    clearCookie(res, name, name !== "bb_tv_ui");
  }

  return res;
}

export async function POST() {
  const res = NextResponse.json(
    {
      ok: true,
      source: "tv-logout",
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    },
  );

  return clearTvCookies(res);
}

export async function GET(req: Request) {
  const res = NextResponse.redirect(new URL("/tv/login", req.url), {
    status: 303,
  });

  return clearTvCookies(res);
}