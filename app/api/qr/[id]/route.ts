import { NextResponse } from "next/server";
import {
  requireAnySessionRole,
  securityJson,
} from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Eski QR mutation endpoint'i artık kullanılmıyor. QR görüntüsü
 * /api/qr-image/[id], kurye akışı ise güvenli driver session üzerinden çalışır.
 */
async function gone(req: Request) {
  const authError = await requireAnySessionRole(req, ["admin", "tv", "driver"]);
  if (authError) return authError;

  return securityJson(
    {
      ok: false,
      error: "legacy_qr_endpoint_disabled",
    },
    410,
  );
}

export async function GET(req: Request) {
  return gone(req);
}

export async function POST(req: Request) {
  return gone(req);
}
