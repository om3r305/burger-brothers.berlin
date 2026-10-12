import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma, getTenantId } from "@/lib/db";
import { requireSessionRole } from "@/lib/server/request-security";
import { visitorReport } from "@/lib/server/analytics-report";
import { berlinDateKey, reportRange } from "@/lib/reporting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  const authError = await requireSessionRole(req, "admin");
  if (authError) return authError;
  let range;
  try {
    const query = new URL(req.url).searchParams;
    range = reportRange(query.get("period") || "day", query.get("date") || berlinDateKey());
  } catch {
    return NextResponse.json({ ok: false, error: "Geçerli bir tarih ve dönem seçin." }, { status: 400, headers });
  }
  try {
    const tenantId = await getTenantId();
    const [visitors, orders] = await Promise.all([
      visitorReport(tenantId, range.from, range.to),
      prisma.$queryRaw<Array<{ date: string; orders: bigint; cancelled: bigint; revenue: number; customers: bigint; unidentified: bigint; pickup: bigint; delivery: bigint }>>(Prisma.sql`
        WITH registered AS (
          SELECT *, to_char("ts" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Berlin', 'YYYY-MM-DD') AS date,
            COALESCE("meta"->>'statusManual', "status") IN ('cancelled', 'canceled', 'storniert') AS cancelled,
            CASE WHEN "anonymizedAt" IS NULL THEN COALESCE(
              NULLIF(regexp_replace("customer"->>'phone', '[^0-9]', '', 'g'), ''),
              NULLIF(lower("customer"->>'email'), ''), NULLIF("customer"->>'id', '')) END AS customer_key
          FROM "Order"
          WHERE "tenantId" = ${tenantId} AND "ts" >= ${range.from} AND "ts" < ${range.to}
            AND "meta"->'paymentSession' IS NULL
            AND "status" IN ('new', 'received', 'eingegangen', 'preparing', 'ready', 'out_for_delivery', 'done', 'delivered', 'completed', 'cancelled', 'canceled', 'storniert')
            AND (COALESCE("meta"->>'paymentMethod', "meta"->'payment'->>'method', 'cash') NOT IN ('online', 'stripe', 'card', 'split_contactless')
              OR COALESCE("meta"->>'paymentStatus', "meta"->'payment'->>'status') IN ('paid', 'succeeded', 'refunded', 'partially_refunded'))
        )
        SELECT COALESCE(date, 'total') AS date,
          COUNT(*) FILTER (WHERE NOT cancelled) AS orders,
          COUNT(*) FILTER (WHERE cancelled) AS cancelled,
          COALESCE(SUM(total) FILTER (WHERE NOT cancelled), 0)::float8 AS revenue,
          COUNT(DISTINCT customer_key) FILTER (WHERE NOT cancelled) AS customers,
          COUNT(*) FILTER (WHERE NOT cancelled AND customer_key IS NULL) AS unidentified,
          COUNT(*) FILTER (WHERE NOT cancelled AND mode IN ('pickup', 'abholung')) AS pickup,
          COUNT(*) FILTER (WHERE NOT cancelled AND mode NOT IN ('pickup', 'abholung')) AS delivery
        FROM registered GROUP BY GROUPING SETS ((date), ()) ORDER BY date
      `),
    ]);
    return NextResponse.json({ ok: true, range: { ...range, timezone: "Europe/Berlin" }, visitors,
      orders: orders.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "bigint" ? Number(value) : value]))) }, { headers });
  } catch (error) {
    console.error("[reports/overview]", error instanceof Error ? error.message : "query_failed");
    return NextResponse.json({ ok: false, error: "Rapor verileri alınamadı. Yeniden deneyin." }, { status: 500, headers });
  }
}
