/**
 * Brian — lightweight client inference for TV LED & group badge.
 *
 * Çalışma mantığı:
 * - Client/TV tarafı DB'ye direkt bağlanmaz.
 * - Önce API'den çeker: /api/brian/export?format=json
 * - Bu API DB-first çalışır:
 *   BrianLearnLog -> model üretir -> BrianRouteModel içine kaydeder.
 * - API olmazsa fallback: /public/data/route_clusters.json
 */

export type BrianPair = {
  a: string;
  b: string;
  support: number;
  lift: number;
  confidence_lb: number;
  negative?: boolean;
};

export type BrianCluster = {
  id: string;
  color?: string;
  streets: string[];
  confidence?: number;
};

export type BrianData = {
  meta?: {
    updatedAt?: number | string;
    firstLearnAt?: string | null;
    windowDays?: number;
    thresholds?: {
      support: number;
      lift: number;
      confidence_lb: number;
    };
    storage?: "db" | "file" | "empty" | string;
    logCount?: number;
  };
  clusters: BrianCluster[];
  pairs: BrianPair[];
};

let cache: BrianData | null = null;
let pending: Promise<BrianData> | null = null;
let cacheAt = 0;

const BRIAN_CACHE_TTL_MS = 30_000;

export function normalizeStreet(raw: string): string {
  if (!raw) return "";

  let s = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");

  s = s.split(",")[0];
  s = s.replace(/strasse/g, "straße");
  s = s.replace(/\s+\d+[a-z]?\b/gi, "");
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

function num(value: any, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function resolveThresholds(d: any) {
  const meta = d?.meta || {};
  const thr = meta?.thresholds || {};

  return {
    support: num(thr?.support ?? d?.minSupport, 12),
    lift: num(thr?.lift ?? d?.minLift, 1.5),
    confidence_lb: num(thr?.confidence_lb, 0.99),
  };
}

function resolveUpdatedAt(d: any): number | undefined {
  const raw = d?.meta?.updatedAt ?? d?.updatedAt;

  if (raw == null) return undefined;
  if (typeof raw === "number") return raw;

  const parsed = Date.parse(String(raw));
  return parsed || undefined;
}

function safePair(raw: any): BrianPair | null {
  const a = normalizeStreet(String(raw?.a || ""));
  const b = normalizeStreet(String(raw?.b || ""));

  if (!a || !b || a === b) return null;

  return {
    a,
    b,
    support: num(raw?.support, 0),
    lift: num(raw?.lift, 0),
    confidence_lb: num(raw?.confidence_lb, 0),
    negative: Boolean(raw?.negative),
  };
}

function safeCluster(raw: any): BrianCluster | null {
  const id = String(raw?.id || "").trim();
  if (!id) return null;

  const rawStreets: any[] = Array.isArray(raw?.streets) ? raw.streets : [];

  const streets: string[] = Array.from(
    new Set<string>(
      rawStreets
        .map((s: any) => normalizeStreet(String(s || "")))
        .filter((s: string) => Boolean(s))
    )
  );

  return {
    id,
    color: raw?.color ? String(raw.color) : undefined,
    streets,
    confidence: raw?.confidence != null ? num(raw.confidence, 0) : undefined,
  };
}

function toBrianData(raw: any): BrianData {
  const thresholds = resolveThresholds(raw);
  const updatedAt = resolveUpdatedAt(raw);
  const windowDays = num(raw?.windowDays ?? raw?.meta?.windowDays, 60);

  const pairs: BrianPair[] = Array.isArray(raw?.pairs)
    ? (raw.pairs.map(safePair).filter(Boolean) as BrianPair[])
    : [];

  const clusters: BrianCluster[] = Array.isArray(raw?.clusters)
    ? (raw.clusters.map(safeCluster).filter(Boolean) as BrianCluster[])
    : [];

  return {
    meta: {
      updatedAt,
      firstLearnAt: raw?.meta?.firstLearnAt ?? null,
      windowDays,
      thresholds,
      storage: raw?.meta?.storage,
      logCount: raw?.meta?.logCount != null ? num(raw.meta.logCount, 0) : undefined,
    },
    pairs,
    clusters,
  };
}

function emptyBrianData(): BrianData {
  return {
    meta: {
      updatedAt: Date.now(),
      firstLearnAt: null,
      windowDays: 60,
      thresholds: {
        support: 12,
        lift: 1.5,
        confidence_lb: 0.99,
      },
      storage: "empty",
      logCount: 0,
    },
    clusters: [],
    pairs: [],
  };
}

async function fetchJson(url: string) {
  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Brian fetch failed: ${res.status}`);
  }

  return res.json();
}

export async function loadBrian(): Promise<BrianData> {
  const now = Date.now();

  if (cache && now - cacheAt < BRIAN_CACHE_TTL_MS) {
    return cache;
  }

  if (!pending) {
    const ts = now;

    pending = fetchJson(`/api/brian/export?format=json&ts=${ts}`)
      .catch(() => fetchJson(`/data/route_clusters.json?ts=${ts}`))
      .catch(() => emptyBrianData())
      .then((raw) => {
        const d = toBrianData(raw || {});
        cache = d;
        cacheAt = Date.now();
        pending = null;
        return d;
      })
      .catch((err) => {
        console.error("Brian load failed", err);

        const d = emptyBrianData();
        cache = d;
        cacheAt = Date.now();
        pending = null;

        return d;
      });
  }

  return pending;
}

export async function refreshBrian(): Promise<BrianData> {
  cache = null;
  pending = null;
  cacheAt = 0;

  return loadBrian();
}

export function clusterColorOf(street: string, data?: BrianData | null): string | null {
  const d = data || cache;
  if (!d) return null;

  const s = normalizeStreet(street);

  for (const c of d.clusters || []) {
    if ((c.streets || []).includes(s)) return c.color || null;
  }

  return null;
}

export function clusterIdOf(street: string, data?: BrianData | null): string | null {
  const d = data || cache;
  if (!d) return null;

  const s = normalizeStreet(street);

  for (const c of d.clusters || []) {
    if ((c.streets || []).includes(s)) return c.id || null;
  }

  return null;
}

export type BrianGateConfig = {
  host?: string;
  goLiveAt?: string;
  enableAfterDays?: number;
  allowedHosts?: string[];
  force?: "on" | "off";
};

function daysDiff(a: Date, b: Date) {
  return Math.floor((+a - +b) / (1000 * 60 * 60 * 24));
}

export function brianIsActive(meta: BrianData["meta"], cfg: BrianGateConfig = {}): boolean {
  if (cfg.force === "on") return true;
  if (cfg.force === "off") return false;

  const allowed =
    cfg.allowedHosts && cfg.allowedHosts.length
      ? !!cfg.allowedHosts.find(
          (h) => h.toLowerCase() === (cfg.host || "").toLowerCase()
        )
      : true;

  if (!allowed) return false;

  const enableAfter = Number.isFinite(cfg.enableAfterDays as any)
    ? (cfg.enableAfterDays as number)
    : 30;

  const startIso = cfg.goLiveAt || meta?.firstLearnAt || null;
  if (!startIso) return false;

  const start = new Date(startIso);
  if (!Number.isFinite(start.valueOf())) return false;

  return daysDiff(new Date(), start) >= enableAfter;
}

export function analyze(
  street: string,
  peers: string[],
  data?: BrianData | null,
  gateOn: boolean = true
): { led: "green" | "red" | "gray"; clusterId?: string; clusterColor?: string } {
  const d = data || cache;
  if (!d) return { led: "gray" };

  const s = normalizeStreet(street);

  const normPeers: string[] = (peers || [])
    .map((p) => normalizeStreet(p))
    .filter((p) => Boolean(p) && p !== s);

  const color = clusterColorOf(s, d) || undefined;
  const cid = clusterIdOf(s, d) || undefined;

  if (!s || normPeers.length === 0) {
    return {
      led: "gray",
      clusterId: cid,
      clusterColor: color,
    };
  }

  const th = resolveThresholds(d);

  let good = false;
  let bad = false;

  for (const p of d.pairs || []) {
    const a = normalizeStreet(p.a);
    const b = normalizeStreet(p.b);

    const hit =
      (a === s && normPeers.includes(b)) ||
      (b === s && normPeers.includes(a));

    if (!hit) continue;

    const supportOk = (p.support ?? 0) >= th.support;
    const liftOk = (p.lift ?? 0) >= th.lift;
    const confOk = (p.confidence_lb ?? 0) >= th.confidence_lb;

    if (p.negative) {
      if (confOk) bad = true;
    } else if (supportOk && liftOk && confOk) {
      good = true;
    }

    if (good || bad) break;
  }

  if (!gateOn) {
    return {
      led: bad ? "red" : "gray",
      clusterId: cid,
      clusterColor: color,
    };
  }

  return {
    led: bad ? "red" : good ? "green" : "gray",
    clusterId: cid,
    clusterColor: color,
  };
}

export function buildLegend(
  data?: BrianData | null,
  max = 8
): Array<{ id: string; color: string; size: number; example?: string }> {
  const d = data || cache;
  if (!d) return [];

  return (d.clusters || [])
    .map((c) => ({
      id: c.id,
      color: c.color || "#9ca3af",
      size: (c.streets || []).length,
      example: c.streets?.[0],
    }))
    .sort((a, b) => b.size - a.size)
    .slice(0, Math.max(1, max));
}

export function groupByCluster(
  streets: string[],
  data?: BrianData | null
): Record<string, string[]> {
  const d = data || cache;
  const out: Record<string, string[]> = {};
  const otherKey = "__none";

  for (const raw of streets || []) {
    const s = normalizeStreet(raw);
    const cid = d ? clusterIdOf(s, d) || otherKey : otherKey;

    if (!out[cid]) out[cid] = [];
    out[cid].push(raw);
  }

  return out;
}

const GROUP_PALETTE = [
  "#22c55e",
  "#a855f7",
  "#3b82f6",
  "#f59e0b",
  "#14b8a6",
  "#6366f1",
  "#84cc16",
  "#06b6d4",
  "#d946ef",
];

function hashString(s: string): number {
  let h = 2166136261;

  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }

  return Math.abs(h | 0);
}

type Thresholds = {
  support: number;
  lift: number;
  confidence_lb: number;
};

function meetsPositive(p: BrianPair, th: Thresholds): boolean {
  if (p.negative) return false;

  return (
    (p.support ?? 0) >= th.support &&
    (p.lift ?? 0) >= th.lift &&
    (p.confidence_lb ?? 0) >= th.confidence_lb
  );
}

export type BrianGroup = {
  id: string;
  label: string;
  color: string;
  size: number;
  streets: string[];
  example?: string;
};

export function groupByPeers(
  streets: string[],
  data?: BrianData | null,
  gateOn: boolean = true
): BrianGroup[] {
  const d = data || cache;
  if (!d) return [];

  const th = resolveThresholds(d);

  const S: string[] = Array.from(
    new Set<string>(
      (streets || [])
        .map((street) => normalizeStreet(street))
        .filter((street) => Boolean(street))
    )
  );

  const pos = new Set<string>();

  for (const p of d.pairs || []) {
    const a = normalizeStreet(p.a);
    const b = normalizeStreet(p.b);

    if (!a || !b) continue;
    if (!S.includes(a) || !S.includes(b)) continue;

    if (meetsPositive(p, th)) {
      const key = a < b ? `${a}||${b}` : `${b}||${a}`;
      pos.add(key);
    }
  }

  const adj = new Map<string, Set<string>>();
  S.forEach((s) => adj.set(s, new Set()));

  for (const k of pos) {
    const [a, b] = k.split("||");

    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());

    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  }

  const seen = new Set<string>();
  const comps: string[][] = [];

  for (const s of S) {
    if (seen.has(s)) continue;

    const st = [s];
    const g: string[] = [];

    seen.add(s);

    while (st.length) {
      const cur = st.pop()!;
      g.push(cur);

      for (const nb of adj.get(cur) || []) {
        if (!seen.has(nb)) {
          seen.add(nb);
          st.push(nb);
        }
      }
    }

    comps.push(g.sort());
  }

  comps.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));

  const labels = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

  return comps.map((g, i) => {
    const key = g.join("|");
    const h = hashString(key);

    const color =
      !gateOn || g.length < 2
        ? "#9ca3af"
        : GROUP_PALETTE[h % GROUP_PALETTE.length];

    return {
      id: `grp_${h.toString(36)}`,
      label: labels[i % labels.length],
      color,
      size: g.length,
      streets: g,
      example: g[0],
    };
  });
}

export function groupOfStreet(street: string, groups: BrianGroup[]): BrianGroup | null {
  const s = normalizeStreet(street);

  for (const g of groups || []) {
    if (g.streets.includes(s)) return g;
  }

  return null;
}