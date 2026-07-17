// app/api/qr-image/[id]/route.ts
import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { prisma, getTenantId } from "@/lib/db";
import {
  enforceRateLimit,
  requireAnySessionRole,
} from "@/lib/server/request-security";

export const revalidate = 0;
export const dynamic = "force-dynamic";

function cleanOrderId(value: string) {
  return String(value || "")
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "");
}

function baseUrlFromRequest(req: Request) {
  const envUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

  if (envUrl) return envUrl.replace(/\/+$/, "");

  try {
    const url = new URL(req.url);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "";
  }
}

async function orderExists(id: string) {
  try {
    const tenantId = await getTenantId();

    const found = await prisma.order.findFirst({
      where: {
        tenantId,
        id,
      },
      select: {
        id: true,
      },
    });

    return Boolean(found);
  } catch (error) {
    console.error("[qr-image] order lookup failed:", error);
    return false;
  }
}

export async function GET(req: Request, ctx: { params: { id: string } }) {
  const authError = await requireAnySessionRole(req, ["admin", "tv"]);
  if (authError) return authError;

  const rateError = enforceRateLimit(req, "qr:image", 60, 60_000);
  if (rateError) return rateError;

  const id = cleanOrderId(ctx.params.id);

  if (!id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }

  const exists = await orderExists(id);

  if (!exists) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const base = baseUrlFromRequest(req);
  const qrUrl = `${base}/qr/${encodeURIComponent(id)}`;

  const png = await QRCode.toBuffer(qrUrl, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 0,
    width: 480,
  });

  return new NextResponse(png, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
    },
  });
}