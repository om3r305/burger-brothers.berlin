
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const t = await prisma.tenant.findFirst();
    const tenantId = t?.id ?? (await prisma.tenant.create({ data: { name: "Default", slug: "default" } })).id;
    const s = await prisma.settings.upsert({ where: { tenantId }, update: {}, create: { tenantId, data: {} } });
    return NextResponse.json({ ok: true, settings: s.data, tenantId });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "fail" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const t = await prisma.tenant.findFirst();
    const tenantId = t?.id ?? (await prisma.tenant.create({ data: { name: "Default", slug: "default" } })).id;
    const s = await prisma.settings.upsert({ where: { tenantId }, update: { data: body || {} }, create: { tenantId, data: body || {} } });
    return NextResponse.json({ ok: true, settings: s.data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "fail" }, { status: 500 });
  }
}
