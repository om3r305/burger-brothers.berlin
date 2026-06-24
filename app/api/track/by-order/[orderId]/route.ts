import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_: Request, { params }: { params: { orderId: string } }) {
  try {
    const tenantId = await getTenantId();
    const orderId = String(params.orderId || "");
    if (!orderId) return NextResponse.json({ error: "bad_request" }, { status: 400 });

    const rows = await prisma.trackingSession.findMany({
      where: { tenantId, orderIds: { has: orderId } },
      orderBy: { updatedAt: "desc" },
      take: 1,
    });

    const row = rows[0];
    if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

    return NextResponse.json({
      session: row.id,
      active: row.active,
      last: row.last ?? undefined,
      history: row.history ?? [],
      driverId: row.driverId || undefined,
      orders: row.orderIds,
      updatedAt: row.updatedAt.getTime(),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "GET_FAILED" }, { status: 500 });
  }
}
