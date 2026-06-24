// app/api/qr-image/[id]/route.ts
import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { getById, readAll, writeAll } from "@/lib/server/db";

export const revalidate = 0;

const DEFAULT_QR_TTL_MIN = 240;

function createRandomToken(len = 32) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function minutesFromNow(min: number) {
  return Date.now() + Math.max(0, Math.floor(min)) * 60_000;
}

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const id = ctx.params.id;
  const prev = getById(id);
  if (!prev) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let token: string | null = (prev as any).qrToken || null;
  const expired = !(prev as any).qrTokenExpiresAt || (prev as any).qrTokenExpiresAt < Date.now();
  if (!token || expired) {
    token = createRandomToken(32);
    const exp = minutesFromNow(DEFAULT_QR_TTL_MIN);
    const list = readAll();
    const idx = list.findIndex((x) => x.id === id);
    if (idx >= 0) {
      (list[idx] as any).qrToken = token;
      (list[idx] as any).qrTokenExpiresAt = exp;
      writeAll(list);
    }
  }

  const base =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  const qrUrl = `${base}/qr/${token}`;

  const png = await QRCode.toBuffer(qrUrl, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 0,
    width: 480,
  });

  return new NextResponse(png, {
    status: 200,
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
  });
}
