import { NextResponse } from "next/server";
import { prisma, getTenantId, Prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type TrackPoint = {
  lat: number;
  lng: number;
  ts: number;
  speed?: number;
  heading?: number;
};

export async function GET(_: Request, { params }: { params: { session: string } }) {
  try {
    const tenantId = await getTenantId();
    const id = String(params.session || "");
    const row = await prisma.trackingSession.findUnique({ where: { id } });
    if (!row || row.tenantId !== tenantId) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({
      id: row.id,
      createdAt: row.createdAt.getTime(),
      active: row.active,
      driverId: row.driverId || undefined,
      orders: row.orderIds,
      last: row.last ?? undefined,
      history: row.history ?? [],
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "GET_FAILED" }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: { session: string } }) {
  try {
    const tenantId = await getTenantId();
    const id = String(params.session || "");
    const body = await req.json().catch(() => ({} as any));
    const { lat, lng, speed, heading, orderIds, driverId, active } = body || {};

    if (typeof lat !== "number" || typeof lng !== "number") {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }

    const now = Date.now();
    const point: TrackPoint = { lat, lng, ts: now };
    if (typeof speed === "number") point.speed = speed;
    if (typeof heading === "number") point.heading = heading;

    const existing = await prisma.trackingSession.findUnique({ where: { id } });
    const prevHistory = (existing?.history as any[]) || [];
    const nextHistory = [...prevHistory, point].slice(-200);

    const nextOrderIds: string[] = Array.isArray(existing?.orderIds) ? [...existing!.orderIds] : [];
    if (Array.isArray(orderIds)) {
      for (const oid of orderIds.map(String)) {
        if (!nextOrderIds.includes(oid)) nextOrderIds.push(oid);
      }
    }

    await prisma.trackingSession.upsert({
      where: { id },
      update: {
        tenantId,
        active: active === false ? false : true,
        driverId: driverId ? String(driverId) : existing?.driverId || null,
        orderIds: nextOrderIds,
        last: point as Prisma.InputJsonValue,
        history: nextHistory as Prisma.InputJsonValue,
      },
      create: {
        id,
        tenantId,
        active: active === false ? false : true,
        driverId: driverId ? String(driverId) : null,
        orderIds: nextOrderIds,
        last: point as Prisma.InputJsonValue,
        history: nextHistory as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "POST_FAILED" }, { status: 500 });
  }
}
