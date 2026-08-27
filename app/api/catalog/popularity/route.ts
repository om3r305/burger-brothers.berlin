import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const CACHE_TTL_MS = 30_000;
const WHOLE_SETTINGS_KEYS = ["settings", "bb_settings_v6", "app:settings", "popularity"];

let popularityCache:
  | {
      tenantId: string;
      expiresAt: number;
      value: Record<string, 1 | 2 | 3>;
    }
  | null = null;

function normalizeKey(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeCategory(value: unknown) {
  const raw = String(value ?? "").toLowerCase().trim();
  if (raw.includes("vegan") || raw.includes("vegetar")) return "vegan";
  if (raw.includes("burger")) return "burger";
  return raw;
}

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function toDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(String(value).trim());
  if (Number.isFinite(numeric) && numeric > 0) {
    const date = new Date(numeric);
    if (Number.isFinite(date.valueOf())) return date;
  }
  const parsed = new Date(String(value));
  return Number.isFinite(parsed.valueOf()) ? parsed : null;
}

function readPopularityStartAt(rows: Array<{ key: string; value: unknown }>) {
  for (const row of rows) {
    const stored = objectValue(row.value);
    const root = objectValue(stored.settings ?? stored.data ?? stored);
    const raw =
      row.key === "popularity"
        ? root.startAt ?? root.popularity?.startAt
        : root.popularity?.startAt;
    const date = toDate(raw);
    if (date) return date;
  }
  return null;
}

function orderItems(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  const root = objectValue(value);
  if (Array.isArray(root.items)) return root.items;
  if (Array.isArray(root.lines)) return root.lines;
  return [];
}

function lineKeys(line: any) {
  const values = [
    line?.productId,
    line?.productSku,
    line?.sku,
    line?.id,
    line?.code,
    line?.item?.id,
    line?.item?.sku,
    line?.item?.code,
    line?.product?.id,
    line?.product?.sku,
    line?.product?.code,
    line?.name,
    line?.title,
    line?.item?.name,
    line?.item?.title,
    line?.product?.name,
    line?.product?.title,
  ];
  return Array.from(new Set(values.map(normalizeKey).filter(Boolean)));
}

function lineQty(line: any) {
  const qty = Number(line?.qty ?? line?.quantity ?? 1);
  return Number.isFinite(qty) && qty > 0 ? qty : 1;
}

function isCancelledOrder(order: { status: string; meta: unknown; cancelledAt: Date | null }) {
  if (order.cancelledAt) return true;
  const meta = objectValue(order.meta);
  const status = String(meta.statusManual ?? order.status ?? meta.status ?? "")
    .trim()
    .toLowerCase();
  return ["cancelled", "canceled", "storniert", "storno", "iptal"].includes(status);
}

function productKeys(product: { id: string; sku: string; name: string }) {
  return Array.from(
    new Set([product.id, product.sku, product.name].map(normalizeKey).filter(Boolean)),
  );
}

async function computePopularityRanks(tenantId: string) {
  const settingsRows = await prisma.setting.findMany({
    where: { tenantId, key: { in: WHOLE_SETTINGS_KEYS } },
    select: { key: true, value: true },
  });
  const startAt = readPopularityStartAt(settingsRows);

  const [products, orders] = await Promise.all([
    prisma.product.findMany({
      where: { tenantId, active: true },
      select: { id: true, sku: true, name: true, category: true },
    }),
    prisma.order.findMany({
      where: {
        tenantId,
        ...(startAt ? { ts: { gte: startAt } } : {}),
      },
      select: { items: true, status: true, meta: true, cancelledAt: true },
    }),
  ]);

  const eligible = products.filter((product) => {
    const category = normalizeCategory(product.category);
    return category === "burger" || category === "vegan";
  });

  const keyToProductId = new Map<string, string>();
  for (const product of eligible) {
    for (const key of productKeys(product)) {
      if (!keyToProductId.has(key)) keyToProductId.set(key, product.id);
    }
  }

  const counts = new Map<string, number>();
  for (const order of orders) {
    if (isCancelledOrder(order)) continue;
    for (const line of orderItems(order.items)) {
      const productId = lineKeys(line)
        .map((key) => keyToProductId.get(key))
        .find(Boolean);
      if (!productId) continue;
      counts.set(productId, (counts.get(productId) || 0) + lineQty(line));
    }
  }

  const ranks: Record<string, 1 | 2 | 3> = {};
  for (const category of ["burger", "vegan"] as const) {
    const top = eligible
      .filter((product) => normalizeCategory(product.category) === category)
      .filter((product) => (counts.get(product.id) || 0) > 0)
      .sort((left, right) => {
        const countDelta = (counts.get(right.id) || 0) - (counts.get(left.id) || 0);
        return countDelta || left.name.localeCompare(right.name, "de");
      })
      .slice(0, 3);

    top.forEach((product, index) => {
      ranks[product.id] = (index + 1) as 1 | 2 | 3;
    });
  }

  return ranks;
}

export async function GET() {
  try {
    const tenantId = await getTenantId();
    if (
      popularityCache?.tenantId === tenantId &&
      popularityCache.expiresAt > Date.now()
    ) {
      return NextResponse.json(
        { ok: true, source: "db", ranks: popularityCache.value, memoryCached: true },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const ranks = await computePopularityRanks(tenantId);
    popularityCache = {
      tenantId,
      expiresAt: Date.now() + CACHE_TTL_MS,
      value: ranks,
    };

    return NextResponse.json(
      { ok: true, source: "db", ranks, memoryCached: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[catalog:popularity] failed", error);
    return NextResponse.json(
      { ok: false, source: "db", ranks: {}, error: "POPULARITY_READ_FAILED" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
