import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const tenantId = await getTenantId();
    const id = String(params?.id || "");
    if (!id) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

    const row = await prisma.order.findFirst({ where: { tenantId, id } });
    if (!row) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

    const customer = (row.customer as any) || {};
    const meta = (row.meta as any) || {};

    const item = {
      id: row.id,
      ts: row.ts instanceof Date ? row.ts.getTime() : Date.now(),
      mode: row.mode,
      channel: row.channel || "web",
      status: meta.statusManual || row.status,
      merchandise: Number(row.merchandise || 0),
      discount: Number(row.discount || 0),
      surcharges: Number(row.surcharges || 0),
      total: Number(row.total || 0),
      coupon: row.coupon ?? null,
      couponDiscount: Number(row.couponDiscount || 0),
      customer,
      items: Array.isArray(row.items) ? row.items : [],
      meta,
      planned: row.planned ?? undefined,
      etaMin: row.etaMin ?? undefined,
    };

    return NextResponse.json({ ok: true, item });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "GET_FAILED" }, { status: 500 });
  }
}
