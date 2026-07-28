import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";
import {
  requireMutationRole,
  requireSessionRole,
} from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store" };

export async function GET(req: Request) {
  const auth = await requireSessionRole(req, "admin");
  if (auth) return auth;
  const tenantId = await getTenantId();
  const [unreadCount, items] = await Promise.all([
    prisma.adminInboxNotification.count({
      where: { tenantId, status: "unread" },
    }),
    prisma.adminInboxNotification.findMany({
      where: { tenantId, status: { in: ["unread", "read"] } },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
  ]);

  return NextResponse.json(
    {
      ok: true,
      unreadCount,
      items: items.map((item) => ({
        id: item.id,
        type: item.type,
        title: item.title,
        body: item.body,
        url: item.url,
        status: item.status,
        createdAt: item.createdAt,
      })),
    },
    { headers: HEADERS },
  );
}

export async function PATCH(req: Request) {
  const auth = await requireMutationRole(req, ["admin"]);
  if (auth) return auth;
  const tenantId = await getTenantId();
  const body = await req.json().catch(() => ({}));
  const id = String(body?.id || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
  const action = String(body?.action || "read");

  if (action === "read_all") {
    await prisma.adminInboxNotification.updateMany({
      where: { tenantId, status: "unread" },
      data: { status: "read", readAt: new Date() },
    });
    return NextResponse.json({ ok: true }, { headers: HEADERS });
  }
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "notification_id_required" },
      { status: 400, headers: HEADERS },
    );
  }
  await prisma.adminInboxNotification.updateMany({
    where: { id, tenantId, status: "unread" },
    data: { status: "read", readAt: new Date() },
  });
  return NextResponse.json({ ok: true }, { headers: HEADERS });
}
