// lib/ordersStore.ts
// ✅ Backwards compatible RAM store + DB mirror (no breaking changes)
// Fixes Prisma JSON null typing: use Prisma.JsonNull instead of null where needed.

import { Prisma } from "@prisma/client";

export type Mode = "pickup" | "delivery";
export type OrderItem = {
  name: string;
  qty: number;
  category?: string;
  add?: { label?: string; name?: string; price?: number }[];
  note?: string;
};

export type OrderRecord = {
  id: string;
  ts: number;
  mode: Mode;
  total: number;
  items: OrderItem[];
  address?: any;
  status: "Eingegangen" | "In Arbeit" | "Bereit" | "Abgeschlossen";
  etaMin?: number;
};

const g = global as any;
if (!g.__ORDERS_STORE__) g.__ORDERS_STORE__ = new Map<string, OrderRecord>();
const store: Map<string, OrderRecord> = g.__ORDERS_STORE__;

/** Map (DE UI) → DB status (unified) */
function toDbStatus(s: OrderRecord["status"]) {
  switch (s) {
    case "Eingegangen":
      return "new";
    case "In Arbeit":
      return "preparing";
    case "Bereit":
      return "ready";
    case "Abgeschlossen":
      return "done";
    default:
      return "new";
  }
}

function toDateOrNow(ts: number) {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n) : new Date();
}

function moneyStr(v: any) {
  const n = Number(v);
  const safe = Number.isFinite(n) ? n : 0;
  return safe.toFixed(2);
}

/** Convert to Prisma JSON-safe value (never plain null on top-level json fields) */
function jsonOrNull(v: any): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  if (v === null || v === undefined) return Prisma.JsonNull;
  return v as any;
}

/**
 * DB mirror helpers
 * - Dynamic import so this file can be imported safely in contexts where DB isn't ready
 * - Never throws: if DB is down, RAM store still works (işleyiş bozulmaz)
 */
async function mirrorSaveToDb(o: OrderRecord) {
  if (typeof window !== "undefined") return; // client: no DB
  try {
    const { prisma, getTenantId } = await import("@/lib/db");
    const tenantId = await getTenantId();

    const itemsJson: Prisma.InputJsonValue = (Array.isArray(o.items) ? o.items : []) as any;

    // customer is a JSON column in your schema (based on your usage in other routes)
    // Put address inside, but avoid plain null at the top level
    const customerJson = jsonOrNull({ address: o.address ?? undefined });

    // IMPORTANT:
    // If your schema uses composite unique (tenantId,id), switch where to:
    // where: { tenantId_id: { tenantId, id: o.id } }
    await prisma.order.upsert({
      where: { id: o.id },
      update: {
        tenantId,
        mode: o.mode,
        status: toDbStatus(o.status),
        total: moneyStr(o.total),
        ts: toDateOrNow(o.ts),
        etaMin: o.etaMin ?? null,
        items: itemsJson,
        customer: customerJson as any,
        // meta untouched here
      },
      create: {
        id: o.id,
        tenantId,
        mode: o.mode,
        channel: null,
        status: toDbStatus(o.status),
        total: moneyStr(o.total),
        ts: toDateOrNow(o.ts),
        etaMin: o.etaMin ?? null,
        items: itemsJson,
        customer: customerJson as any,
        meta: Prisma.JsonNull, // ✅ instead of null
      },
    });
  } catch {
    // ignore (RAM still works)
  }
}

async function mirrorPatchToDb(id: string, patch: Partial<OrderRecord>) {
  if (typeof window !== "undefined") return;
  try {
    const { prisma, getTenantId } = await import("@/lib/db");
    const tenantId = await getTenantId();

    const data: any = { tenantId };

    if (patch.mode) data.mode = patch.mode;
    if (patch.status) data.status = toDbStatus(patch.status as any);
    if (patch.total != null) data.total = moneyStr(patch.total);
    if (patch.ts != null) data.ts = toDateOrNow(patch.ts);
    if (patch.etaMin != null) data.etaMin = patch.etaMin;

    if (patch.items) {
      data.items = (Array.isArray(patch.items) ? patch.items : []) as any;
    }

    if ("address" in patch) {
      data.customer = jsonOrNull({ address: (patch as any).address ?? undefined });
    }

    await prisma.order.update({
      where: { id },
      data,
    });
  } catch {
    // ignore
  }
}

/** ✅ Backwards-compatible API (sync, RAM) */
export function saveOrder(o: OrderRecord) {
  store.set(o.id, o);
  void mirrorSaveToDb(o);
}

export function getOrder(id: string): OrderRecord | undefined {
  return store.get(id);
}

export function updateOrder(id: string, patch: Partial<OrderRecord>) {
  const cur = store.get(id);
  if (!cur) return;
  const next = { ...cur, ...patch };
  store.set(id, next);
  void mirrorPatchToDb(id, patch);
}

export function listOrders(filter?: { status?: OrderRecord["status"] }) {
  const arr = Array.from(store.values());
  if (filter?.status) return arr.filter((o) => o.status === filter.status);
  return arr;
}

/** ✅ Optional DB-first helpers (server-only usage) */
export async function getOrderDb(code: string) {
  const { prisma, getTenantId } = await import("@/lib/db");
  const tenantId = await getTenantId();
  return prisma.order.findFirst({
    where: { tenantId, id: String(code).trim() },
  });
}

export async function listOrdersDb() {
  const { prisma, getTenantId } = await import("@/lib/db");
  const tenantId = await getTenantId();
  return prisma.order.findMany({
    where: { tenantId },
    orderBy: { ts: "desc" },
    take: 200,
  });
}
