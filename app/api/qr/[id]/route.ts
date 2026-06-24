// app/api/qr/[id]/route.ts
import { NextResponse } from "next/server";

/**
 * Bu endpoint şu an için “sağlık/uyumluluk” amaçlıdır.
 * Proje localStorage temelli olduğu için sunucu tarafında gerçek yazma yok.
 * İlerde veritabanına geçildiğinde burada
 * - PIN doğrulama
 * - sipariş durum güncelleme
 * - driver atama / loglama
 * yapılabilir.
 */

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  return NextResponse.json({ ok: true, id: params.id, mode: "qr-api" });
}

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  // Şimdilik sadece 200 dön.
  return NextResponse.json({ ok: true, id: params.id });
}
