// app/api/tv/logout/route.ts
import { NextResponse } from "next/server";
import {
  forbiddenResponse,
  hasTrustedMutationOrigin,
} from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const COOKIES_TO_CLEAR = [
  "bb_tv_auth",
  "bb_tv_ui",

  // legacy/eski isimler
  "bb_tv_sess",
];

function isLoopbackRequest(req: Request) {
  try {
    const hostname = new URL(req.url).hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

function clearCookie(
  req: Request,
  res: NextResponse,
  name: string,
  httpOnly: boolean,
) {
  res.cookies.set(name, "", {
    httpOnly,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && !isLoopbackRequest(req),
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
}

function clearTvCookies(req: Request, res: NextResponse) {
  for (const name of COOKIES_TO_CLEAR) {
    clearCookie(req, res, name, name !== "bb_tv_ui");
  }

  return res;
}

export async function POST(req: Request) {
  if (!hasTrustedMutationOrigin(req)) {
    return forbiddenResponse("origin_not_allowed");
  }

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

  return clearTvCookies(req, res);
}

export async function GET(req: Request) {
  const res = NextResponse.redirect(new URL("/tv/login", req.url), {
    status: 303,
  });

  return clearTvCookies(req, res);
}
