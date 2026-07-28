import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";
import {
  createShowcaseEventAckToken,
  verifyShowcaseEventAckToken,
} from "@/lib/server/showcase-live-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "public, no-store" };

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
  await prisma.showcaseLiveEvent.updateMany({
    where: { tenantId, status: "pending", expiresAt: { lte: now } },
    data: { status: "expired" },
  });
  const event = await prisma.showcaseLiveEvent.findFirst({
    where: {
      tenantId,
      screenSlug: screen,
      status: "pending",
      scheduledAt: { lte: now },
      expiresAt: { gt: now },
    },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
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
  const event = await prisma.showcaseLiveEvent.findFirst({
    where: { id, tenantId },
  });
  if (!event) {
    return NextResponse.json({ ok: false, error: "event_not_found" }, { status: 404, headers: HEADERS });
  }
  await prisma.showcaseLiveEvent.update({
    where: { id },
    data: { status: "played", playedAt: new Date() },
  });

  if (event.sourceType === "winner_submission" && event.sourceId) {
    const remaining = await prisma.showcaseLiveEvent.count({
      where: {
        tenantId,
        sourceType: "winner_submission",
        sourceId: event.sourceId,
        status: "pending",
        expiresAt: { gt: new Date() },
      },
    });
    if (remaining === 0) {
      await prisma.schnellWinnerSubmission.updateMany({
        where: { id: event.sourceId, tenantId, photoStoragePath: { not: null } },
        data: { deleteAfter: new Date(Date.now() + 2 * 60_000) },
      });
    }
  }
  return NextResponse.json({ ok: true }, { headers: HEADERS });
}
