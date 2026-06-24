// app/api/tv/debug/route.ts
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function tryRead(p: string) {
  try {
    const raw = await fs.readFile(p, "utf-8");
    const json = JSON.parse(raw);
    const v = json?.security?.tvPin ? String(json.security.tvPin).trim() : "";
    return { ok: !!v, pin: v, source: `file:${p}` };
  } catch {
    return { ok: false, pin: "", source: `miss:${p}` };
  }
}

export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, error: "disabled in production" }, { status: 403 });
  }

  const candidates = [
    path.join(process.cwd(), "data", "settings.json"),
    path.join(process.cwd(), "burger", "data", "settings.json"),
    path.join(process.cwd(), "src", "data", "settings.json"),
    path.join(process.cwd(), "app", "data", "settings.json"),
  ];

  const tries = [];
  for (const p of candidates) tries.push(await tryRead(p));

  const envPin = process.env.TV_PIN ? String(process.env.TV_PIN).trim() : "";
  const chosen =
    tries.find(t => t.ok) ??
    (envPin ? { ok: true, pin: envPin, source: "env:TV_PIN" } : { ok: true, pin: "19051905", source: "dev:fallback" });

  const tail = chosen.pin ? chosen.pin.slice(-4) : "";
  return NextResponse.json({
    ok: true,
    using: chosen.source,
    pinMasked: chosen.pin ? `****${tail}` : "",
    tries,
    envPresent: !!envPin,
  });
}
