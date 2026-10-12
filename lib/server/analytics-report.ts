import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { berlinDateKey } from "@/lib/reporting";

export type VisitorDay = {
  date: string; views: number; sessions: number; webViews: number; appViews: number;
  unknownViews: number; unidentifiedViews: number; paths: Array<{ path: string; views: number }>;
};

export async function readVisitorDays(tenantId: string | undefined, from: Date | undefined, to: Date) {
  return prisma.$queryRaw<Array<{ tenantId: string; day: VisitorDay }>>(Prisma.sql`
    WITH events AS (
      SELECT "tenantId", "path", "sessionHash", "props"->>'source' AS source,
        to_char("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Berlin', 'YYYY-MM-DD') AS date
      FROM "AnalyticsEvent"
      WHERE "createdAt" < ${to}
        ${from ? Prisma.sql`AND "createdAt" >= ${from}` : Prisma.empty}
        ${tenantId ? Prisma.sql`AND "tenantId" = ${tenantId}` : Prisma.empty}
        AND "event" IN ('page_view', 'screen_view', 'view', 'visit')
        AND "path" !~ '^/(admin|tv|driver|dashboard|visit|showcase|print|kasa|api|_next)(/|$)'
    ), totals AS (
      SELECT "tenantId", date, COUNT(*) AS views, COUNT(DISTINCT "sessionHash") AS sessions,
        COUNT(*) FILTER (WHERE source = 'web') AS web_views,
        COUNT(*) FILTER (WHERE source = 'app') AS app_views,
        COUNT(*) FILTER (WHERE source IS NULL OR source NOT IN ('web', 'app')) AS unknown_views,
        COUNT(*) FILTER (WHERE "sessionHash" IS NULL) AS unidentified_views
      FROM events GROUP BY "tenantId", date
    ), paths AS (
      SELECT "tenantId", date, jsonb_agg(jsonb_build_object('path', path, 'views', views) ORDER BY views DESC) AS paths
      FROM (SELECT "tenantId", date, path, COUNT(*) AS views FROM events GROUP BY "tenantId", date, path) p
      GROUP BY "tenantId", date
    )
    SELECT t."tenantId", jsonb_build_object('date', t.date, 'views', t.views, 'sessions', t.sessions,
      'webViews', t.web_views, 'appViews', t.app_views, 'unknownViews', t.unknown_views,
      'unidentifiedViews', t.unidentified_views, 'paths', p.paths) AS day
    FROM totals t JOIN paths p ON p."tenantId" = t."tenantId" AND p.date = t.date
    ORDER BY t.date
  `);
}

export async function visitorReport(tenantId: string, from: Date, to: Date) {
  const [live, saved] = await Promise.all([
    readVisitorDays(tenantId, from, to),
    prisma.setting.findMany({ where: { tenantId, key: { startsWith: "kv:analytics:daily:" } }, select: { value: true } }),
  ]);
  const days = new Map<string, VisitorDay>();
  const start = berlinDateKey(from), end = berlinDateKey(to);
  for (const row of saved) {
    const day = row.value as unknown as VisitorDay;
    if (day?.date >= start && day.date < end) days.set(day.date, day);
  }
  for (const row of live) days.set(row.day.date, row.day);
  return Array.from(days.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/** Save anonymous daily counts before raw sessions expire; deletion and snapshots are atomic. */
export async function archiveVisitorDays(tenantId: string | undefined, cutoff: Date) {
  const days = await readVisitorDays(tenantId, undefined, cutoff);
  const tenantWhere = tenantId ? { tenantId } : {};
  return prisma.$transaction([
    ...days.map((row) => prisma.setting.upsert({
      where: { tenantId_key: { tenantId: row.tenantId, key: `kv:analytics:daily:${row.day.date}` } },
      create: { tenantId: row.tenantId, key: `kv:analytics:daily:${row.day.date}`, value: row.day as unknown as Prisma.InputJsonValue },
      update: { value: row.day as unknown as Prisma.InputJsonValue },
    })),
    prisma.analyticsEvent.deleteMany({ where: { ...tenantWhere, createdAt: { lt: cutoff } } }),
  ]).then((results) => results[results.length - 1] as { count: number });
}
