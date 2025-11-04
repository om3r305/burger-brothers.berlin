// app/api/tv/login/route.ts
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const COOKIE = "bb_tv_auth";
const MAX_DAYS = 30;

type PinRead = { pin: string; source: string };

async function tryRead(p: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(p, "utf-8");
    const json = JSON.parse(raw);
    const v = json?.security?.tvPin;
    if (v) return String(v).trim();
    return null;
  } catch { return null; }
}

async function readPin(): Promise<PinRead> {
  // Projede settings’in nerede olduğuna göre çoklu aday yolları dene:
  const candidates = [
    path.join(process.cwd(), "data", "settings.json"),
    path.join(process.cwd(), "burger", "data", "settings.json"),
    path.join(process.cwd(), "src", "data", "settings.json"),
    path.join(process.cwd(), "app", "data", "settings.json"),
  ];
  for (const p of candidates) {
    const v = await tryRead(p);
    if (v) return { pin: v, source: `file:${p}` };
  }
  // ENV fallback
  if (process.env.TV_PIN) return { pin: String(process.env.TV_PIN).trim(), source: "env:TV_PIN" };
  // DEV fallback (prod’da boş kalsın)
  if (process.env.NODE_ENV !== "production") return { pin: "19051905", source: "dev:fallback" };
  return { pin: "", source: "none" };
}

export async function POST(req: Request) {
  // Hem form-post hem JSON destekleyelim
  const ct = req.headers.get("content-type") || "";
  let pin = "";
  if (ct.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    pin = String(body?.pin ?? "").trim();
  } else {
    const form = await req.formData().catch(() => null);
    pin = String(form?.get("pin") ?? "").trim();
  }

  const { pin: expected } = await readPin();

  if (!/^\d{4,10}$/.test(pin) || !expected || pin !== expected) {
    const back = new URL("/tv/login?err=1", req.url);
    return NextResponse.redirect(back, { status: 303 });
  }

  const res = NextResponse.redirect(new URL("/tv", req.url), { status: 303 });
  const expires = new Date(Date.now() + MAX_DAYS * 24 * 60 * 60 * 1000);
  res.cookies.set(COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires,
    path: "/",
  });
  return res;
}
