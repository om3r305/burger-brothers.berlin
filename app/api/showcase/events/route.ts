import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";
import {
  createShowcaseEventAckToken,
  verifyShowcaseEventAckToken,
} from "@/lib/server/showcase-live-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store" };
const LOOKAHEAD_MS = 10_000;

function cleanSlug(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 80);
}

export async function GET(req: Request) {
  const screen = cleanSlug(new URL(req.url).searchParams.get("screen")) || "main";
  const tenantId = await getTenantId();
  const now = new Date();
  const lookahead = new Date(now.getTime() + LOOKAHEAD_MS);

  // Polling yolu salt okunur tutulur. Süresi dolan event temizliği cron/admin
  // cleanup tarafından yapılır; her fiziksel ekranın 4 saniyede bir DB write
  // çalıştırması connection pool'u kilitlememelidir.
  const event = await prisma.showcaseLiveEvent.findFirst({
    where: {
      tenantId,
      screenSlug: screen,
      status: "pending",
      scheduledAt: { lte: lookahead },
      expiresAt: { gt: now },
    },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      eventType: true,
      payload: true,
      scheduledAt: true,
      expiresAt: true,
    },
  });

  if (!event) {
    return NextResponse.json({ ok: true, event: null }, { headers: HEADERS });
  }

  return NextResponse.json(
    {
      ok: true,
      event: {
        id: event.id,
        eventType: event.eventType,
        payload: event.payload,
        scheduledAt: event.scheduledAt,
        expiresAt: event.expiresAt,
        ackToken: createShowcaseEventAckToken(event.id, event.expiresAt),
      },
    },
    { headers: HEADERS },
  );
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const id = String(body?.id || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
  const token = String(body?.ackToken || "");

  if (!id || !verifyShowcaseEventAckToken(id, token)) {
    return NextResponse.json(
      { ok: false, error: "invalid_event_ack" },
      { status: 403, headers: HEADERS },
    );
  }

  const tenantId = await getTenantId();
  const updated = await prisma.showcaseLiveEvent.updateMany({
    where: { id, tenantId, status: "pending" },
    data: { status: "played", playedAt: new Date() },
  });

  if (updated.count === 0) {
    // Tekrarlanan ACK idempotent kabul edilir; aynı ekran ağ sebebiyle yeniden
    // gönderdiğinde fazladan sorgu zinciri oluşmaz.
    return NextResponse.json({ ok: true, reused: true }, { headers: HEADERS });
  }

  return NextResponse.json({ ok: true }, { headers: HEADERS });
}
