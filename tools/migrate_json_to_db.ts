// tools/migrate_json_to_db.ts
/**
 * Run with:
 *   npm run migrate:json
 *
 * Copies legacy /data/*.json files into the Prisma/Postgres database.
 */
import fs from "fs";
import path from "path";
import { Prisma } from "@prisma/client";
import { prisma, getTenantId } from "@/lib/db";

type OrderMode = "pickup" | "delivery";

const DATA_DIR = path.resolve(process.cwd(), "data");

function filePath(name: string) {
  return path.join(DATA_DIR, name);
}

function exists(name: string) {
  return fs.existsSync(filePath(name));
}

function readJson(name: string): any | null {
  const fullPath = filePath(name);

  if (!fs.existsSync(fullPath)) {
    console.log("skip (not found):", name);
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(fullPath, "utf-8"));
  } catch (error) {
    console.error("invalid JSON:", name);
    throw error;
  }
}

function jsonValue(value: any): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function num(value: any, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const text = String(value ?? "")
    .trim()
    .replace(/[€\s]/g, "")
    .replace(",", ".");

  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toDate(value: any, fallback = new Date()) {
  if (value instanceof Date && Number.isFinite(value.valueOf())) return value;

  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value);
  }

  if (typeof value === "string" && value.trim()) {
    const asNumber = Number(value);

    if (Number.isFinite(asNumber) && asNumber > 0) {
      return new Date(asNumber);
    }

    const date = new Date(value);
    if (Number.isFinite(date.valueOf())) return date;
  }

  return fallback;
}

function normalizeMode(value: any): OrderMode {
  const text = String(value || "").toLowerCase().trim();

  if (text === "pickup" || text === "abholung" || text === "apollo" || text === "apollon") {
    return "pickup";
  }

  return "delivery";
}

function normalizeStatus(value: any) {
  const text = String(value || "").toLowerCase().trim();

  if (text === "received" || text === "eingegangen") return "new";
  if (text === "prepare" || text === "zubereitung" || text === "in_vorbereitung") return "preparing";
  if (text === "on_the_way" || text === "unterwegs") return "out_for_delivery";
  if (text === "delivered" || text === "completed" || text === "geliefert") return "done";
  if (text === "canceled" || text === "storniert") return "cancelled";

  if (
    text === "new" ||
    text === "preparing" ||
    text === "ready" ||
    text === "out_for_delivery" ||
    text === "done" ||
    text === "cancelled"
  ) {
    return text;
  }

  return "new";
}

function extractArray(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.orders)) return data.orders;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function normalizeOrder(raw: any) {
  const source =
    raw?.order && typeof raw.order === "object"
      ? raw.order
      : raw?.data && typeof raw.data === "object"
        ? raw.data
        : raw;

  const id = String(source?.id || source?.orderId || "").trim();
  if (!id) return null;

  const items = Array.isArray(source?.items) ? source.items : [];
  const customer =
    source?.customer && typeof source.customer === "object" && !Array.isArray(source.customer)
      ? source.customer
      : {};

  const merchandise =
    num(source?.merchandise) ||
    items.reduce((sum: number, item: any) => {
      const qty = Math.max(1, num(item?.qty ?? item?.quantity ?? 1, 1));
      const price = num(item?.price ?? item?.unitPrice);
      return sum + price * qty;
    }, 0);

  const discount = num(source?.discount);
  const surcharges = num(source?.surcharges);
  const couponDiscount = num(source?.couponDiscount ?? source?.meta?.couponDiscount);
  const total =
    num(source?.total ?? source?.amount ?? source?.payable ?? source?.toPay) ||
    Math.max(0, merchandise + surcharges - discount - couponDiscount);

  const ts = toDate(source?.ts ?? source?.createdAt);

  return {
    id,
    mode: normalizeMode(source?.mode),
    channel: source?.channel ? String(source.channel) : "web",
    status: normalizeStatus(source?.status ?? source?.meta?.statusManual),
    merchandise,
    discount,
    surcharges,
    total,
    coupon: source?.coupon ? String(source.coupon) : null,
    couponDiscount,
    customer,
    items,
    meta: source?.meta ?? {},
    ts,
    planned: source?.planned ? String(source.planned) : null,
    etaMin: source?.etaMin == null ? null : Math.round(num(source.etaMin)),
    etaAdjustMin: source?.etaAdjustMin == null ? null : Math.round(num(source.etaAdjustMin)),
    driver: source?.driver ?? null,
    doneAt: normalizeStatus(source?.status) === "done" ? toDate(source?.doneAt ?? source?.updatedAt, ts) : null,
    cancelledAt:
      normalizeStatus(source?.status) === "cancelled"
        ? toDate(source?.cancelledAt ?? source?.updatedAt, ts)
        : null,
    history: source?.history ?? null,
    print: source?.print ?? null,
  };
}

async function upsertSetting(tenantId: string, key: string, value: any) {
  await prisma.setting.upsert({
    where: {
      tenantId_key: {
        tenantId,
        key,
      },
    },
    update: {
      value: jsonValue(value),
    },
    create: {
      tenantId,
      key,
      value: jsonValue(value),
    },
  });

  console.log("migrated setting:", key);
}

async function migrateOrders(tenantId: string, data: any) {
  const rows = extractArray(data);
  let migrated = 0;
  let skipped = 0;

  for (const raw of rows) {
    const order = normalizeOrder(raw);

    if (!order) {
      skipped += 1;
      continue;
    }

    await prisma.order.upsert({
      where: {
        id: order.id,
      },
      update: {
        tenantId,
        mode: order.mode,
        channel: order.channel,
        status: order.status,
        merchandise: order.merchandise,
        discount: order.discount,
        surcharges: order.surcharges,
        total: order.total,
        coupon: order.coupon,
        couponDiscount: order.couponDiscount,
        customer: jsonValue(order.customer),
        items: jsonValue(order.items),
        meta: jsonValue(order.meta),
        ts: order.ts,
        planned: order.planned,
        etaMin: order.etaMin,
        etaAdjustMin: order.etaAdjustMin,
        driver: order.driver == null ? Prisma.JsonNull : jsonValue(order.driver),
        doneAt: order.doneAt,
        cancelledAt: order.cancelledAt,
        history: order.history == null ? Prisma.JsonNull : jsonValue(order.history),
        print: order.print == null ? Prisma.JsonNull : jsonValue(order.print),
      },
      create: {
        id: order.id,
        tenantId,
        mode: order.mode,
        channel: order.channel,
        status: order.status,
        merchandise: order.merchandise,
        discount: order.discount,
        surcharges: order.surcharges,
        total: order.total,
        coupon: order.coupon,
        couponDiscount: order.couponDiscount,
        customer: jsonValue(order.customer),
        items: jsonValue(order.items),
        meta: jsonValue(order.meta),
        ts: order.ts,
        planned: order.planned,
        etaMin: order.etaMin,
        etaAdjustMin: order.etaAdjustMin,
        driver: order.driver == null ? Prisma.JsonNull : jsonValue(order.driver),
        doneAt: order.doneAt,
        cancelledAt: order.cancelledAt,
        history: order.history == null ? Prisma.JsonNull : jsonValue(order.history),
        print: order.print == null ? Prisma.JsonNull : jsonValue(order.print),
      },
    });

    migrated += 1;
  }

  console.log("migrated orders:", migrated);
  if (skipped) console.log("skipped orders:", skipped);
}

async function main() {
  const tenantId = await getTenantId();

  console.log("JSON → DB migration");
  console.log("tenantId:", tenantId);
  console.log("dataDir:", DATA_DIR);

  const settings = readJson("settings.json");
  if (settings) {
    await upsertSetting(tenantId, "settings", settings);
  }

  const tracking = readJson("tracking.json");
  if (tracking) {
    await upsertSetting(tenantId, "tracking", tracking);
  }

  const orders = readJson("orders.json");
  if (orders) {
    await migrateOrders(tenantId, orders);
  } else if (!exists("settings.json") && !exists("tracking.json")) {
    console.log("No legacy JSON files found.");
  }

  console.log("done.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });