import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";
import { getServerSettings } from "@/lib/server/settings";
import { calculateSmartEta, type PublicEtaSummary } from "@/lib/server/smart-eta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 15_000;
const LOOKBACK_MS = 3 * 60 * 60_000;

let cached: { expiresAt: number; value: PublicEtaSummary } | null = null;
let inFlight: Promise<PublicEtaSummary> | null = null;

async function loadEta() {
  const now = new Date();
  const [tenantId, settings] = await Promise.all([
    getTenantId(),
    getServerSettings(),
  ]);

  const orders = await prisma.order.findMany({
    where: {
      tenantId,
      status: { in: ["new", "preparing", "ready", "out_for_delivery"] },
      archivedAt: null,
      anonymizedAt: null,
      ts: { gte: new Date(now.getTime() - LOOKBACK_MS) },
    },
    select: {
      status: true,
      mode: true,
      channel: true,
      items: true,
      meta: true,
      planned: true,
      etaMin: true,
      etaAdjustMin: true,
      ts: true,
      createdAt: true,
    },
    orderBy: { ts: "desc" },
    take: 120,
  });

  return calculateSmartEta({
    baseDelivery: Number(settings?.hours?.avgDeliveryMinutes ?? 35),
    basePickup: Number(settings?.hours?.avgPickupMinutes ?? 15),
    orders,
    now,
  });
}

export async function GET() {
  const now = Date.now();

  try {
    if (cached && cached.expiresAt > now) {
      return NextResponse.json(cached.value, {
        headers: { "Cache-Control": "public, max-age=10, stale-while-revalidate=20" },
      });
    }

    inFlight ??= loadEta().finally(() => {
      inFlight = null;
    });
    const value = await inFlight;
    cached = { value, expiresAt: now + CACHE_TTL_MS };

    return NextResponse.json(value, {
      headers: { "Cache-Control": "public, max-age=10, stale-while-revalidate=20" },
    });
  } catch {
    return NextResponse.json(
      { error: "eta_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
