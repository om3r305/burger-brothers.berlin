// app/api/brian/export/route.ts
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { prisma, getTenantId } from "@/lib/db";
import { enforceRateLimit, requireAnySessionRole, requireMutationRole } from "@/lib/server/request-security";

export const runtime = "nodejs";

const brianDb = prisma as any;

const DATA_DIR = path.join(process.cwd(), "data", "brian");
const LOG_FILE = path.join(DATA_DIR, "learn_log.jsonl");
const OUT_DIR = path.join(process.cwd(), "public", "data");
const OUT_FILE = path.join(OUT_DIR, "route_clusters.json");

// Defaults (Settings’ten ileride override edilir)
const WINDOW_DAYS = Number(process.env.BRIAN_WINDOW_DAYS || 60);
const MIN_SUPPORT = Number(process.env.BRIAN_MIN_SUPPORT || 12);
const MIN_LIFT = Number(process.env.BRIAN_MIN_LIFT || 1.5);
const CONF_Z = Number(process.env.BRIAN_CONF_Z || 2.576); // ~99%

const PALETTE = [
  "#22c55e",
  "#a855f7",
  "#3b82f6",
  "#f59e0b",
  "#14b8a6",
  "#6366f1",
  "#84cc16",
  "#06b6d4",
  "#d946ef",
  "#10b981",
  "#e11d48",
  "#fb7185",
];

type LearnEntry = {
  occurredAt: string;
  mode?: string;
  host?: string;
  ip?: string;
  ua?: string;
  orderId?: string;
  driverId?: string;
  driverName?: string;
  primaryStreet?: string;
  streets: string[];
  peerStreets?: string[];
  status?: string;
  source?: string;
};

type PairOut = {
  a: string;
  b: string;
  support: number;
  lift: number;
  confidence_lb: number;
};

type ClusterOut = {
  id: string;
  color: string;
  streets: string[];
};

type BrianPayload = {
  meta: {
    updatedAt: string;
    firstLearnAt: string | null;
    windowDays: number;
    thresholds: {
      support: number;
      lift: number;
      confidence_lb: number;
    };
    storage: "db" | "file" | "empty";
    logCount: number;
  };
  pairs: PairOut[];
  clusters: ClusterOut[];
};

function daysBetween(a: Date, b: Date) {
  return Math.abs(+a - +b) / (1000 * 60 * 60 * 24);
}

function decayForDays(d: number) {
  if (d <= 30) return 1.0;
  if (d <= 90) return 0.5;
  return 0.25;
}

function normalizeStreet(s: string) {
  const x = (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");

  return x
    .split(",")[0]
    .replace(/strasse/g, "straße")
    .replace(/\bstrasse\b/g, "straße")
    .replace(/\s+(\d+[a-zA-Z]?)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function asStreetArray(raw: any): string[] {
  const arr = Array.isArray(raw) ? raw : [];

  return Array.from(
    new Set(
      arr
        .map((s) => normalizeStreet(String(s || "")))
        .filter(Boolean)
    )
  );
}

// Wilson lower bound of p with z
function wilsonLowerBound(success: number, total: number, z = CONF_Z) {
  if (total <= 0) return 0;

  const p = success / total;
  const denom = 1 + (z * z) / total;
  const center = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));

  return (center - margin) / denom;
}

// basit connected components
function components(nodes: string[], edges: Array<[string, string]>) {
  const adj = new Map<string, Set<string>>();

  nodes.forEach((n) => adj.set(n, new Set()));

  edges.forEach(([a, b]) => {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());

    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  });

  const seen = new Set<string>();
  const comps: string[][] = [];

  for (const n of nodes) {
    if (seen.has(n)) continue;

    const stack = [n];
    const group: string[] = [];

    seen.add(n);

    while (stack.length) {
      const u = stack.pop()!;
      group.push(u);

      for (const v of adj.get(u) || []) {
        if (!seen.has(v)) {
          seen.add(v);
          stack.push(v);
        }
      }
    }

    if (group.length) comps.push(group.sort());
  }

  return comps;
}

function emptyPayload(storage: "db" | "file" | "empty" = "empty"): BrianPayload {
  const now = new Date();

  return {
    meta: {
      updatedAt: now.toISOString(),
      firstLearnAt: null,
      windowDays: WINDOW_DAYS,
      thresholds: {
        support: MIN_SUPPORT,
        lift: MIN_LIFT,
        confidence_lb: 0.99,
      },
      storage,
      logCount: 0,
    },
    pairs: [],
    clusters: [],
  };
}

function readFileEntries(): LearnEntry[] {
  if (!fs.existsSync(LOG_FILE)) return [];

  const lines = fs.readFileSync(LOG_FILE, "utf8").split("\n").filter(Boolean);
  const entries: LearnEntry[] = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      const streets = asStreetArray(entry?.streets);

      if (!streets.length) continue;

      entries.push({
        occurredAt: entry?.occurredAt || new Date().toISOString(),
        mode: entry?.mode,
        host: entry?.host,
        ip: entry?.ip,
        ua: entry?.ua,
        orderId: entry?.orderId,
        driverId: entry?.driverId,
        driverName: entry?.driverName,
        primaryStreet: entry?.primaryStreet,
        streets,
        peerStreets: asStreetArray(entry?.peerStreets),
        status: entry?.status,
        source: entry?.source || "file",
      });
    } catch {
      // bozuk satırı atla
    }
  }

  return entries;
}

async function readDbEntries(): Promise<LearnEntry[]> {
  const tenantId = await getTenantId();
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const rows = await brianDb.brianLearnLog.findMany({
    where: {
      tenantId,
      occurredAt: {
        gte: since,
      },
    },
    orderBy: {
      occurredAt: "asc",
    },
    select: {
      occurredAt: true,
      mode: true,
      orderId: true,
      driverId: true,
      driverName: true,
      primaryStreet: true,
      streets: true,
      peerStreets: true,
      status: true,
      source: true,
      raw: true,
    },
  });

  return rows
    .map((row: any) => {
      const raw = row?.raw || {};
      const streets = asStreetArray(row?.streets);

      return {
        occurredAt: row?.occurredAt
          ? new Date(row.occurredAt).toISOString()
          : raw?.occurredAt || new Date().toISOString(),
        mode: raw?.mode || row?.mode,
        host: raw?.host,
        ip: raw?.ip,
        ua: raw?.ua,
        orderId: row?.orderId || raw?.orderId,
        driverId: row?.driverId || raw?.driverId,
        driverName: row?.driverName || raw?.driverName,
        primaryStreet: row?.primaryStreet || raw?.primaryStreet,
        streets,
        peerStreets: asStreetArray(row?.peerStreets || raw?.peerStreets),
        status: row?.status || raw?.status,
        source: row?.source || raw?.source || "db",
      } as LearnEntry;
    })
    .filter((entry: LearnEntry) => entry.streets.length > 0);
}

async function loadEntries(): Promise<{ entries: LearnEntry[]; storage: "db" | "file" | "empty" }> {
  try {
    const dbEntries = await readDbEntries();

    if (dbEntries.length > 0) {
      return {
        entries: dbEntries,
        storage: "db",
      };
    }
  } catch (err) {
    console.error("❌ Brian export DB read failed, file fallback will be used:", err);
  }

  const fileEntries = readFileEntries();

  if (fileEntries.length > 0) {
    return {
      entries: fileEntries,
      storage: "file",
    };
  }

  return {
    entries: [],
    storage: "empty",
  };
}

async function buildPayload(): Promise<BrianPayload> {
  const now = new Date();
  const { entries, storage } = await loadEntries();

  if (!entries.length) return emptyPayload(storage);

  const streetFreq = new Map<string, number>();
  const pairFreq = new Map<string, number>();
  const coOpp = new Map<string, number>();

  let firstLearnAt: string | null = null;

  for (const entry of entries) {
    const t = entry?.occurredAt ? new Date(entry.occurredAt) : now;

    if (!firstLearnAt || +new Date(firstLearnAt) > +t) {
      firstLearnAt = t.toISOString();
    }

    const ageDays = daysBetween(now, t);
    if (ageDays > WINDOW_DAYS) continue;

    const w = decayForDays(ageDays);
    const uniq = asStreetArray(entry?.streets);

    uniq.forEach((s) => {
      streetFreq.set(s, (streetFreq.get(s) || 0) + w);
    });

    for (let i = 0; i < uniq.length; i++) {
      for (let j = i + 1; j < uniq.length; j++) {
        const a = uniq[i];
        const b = uniq[j];
        const key = a < b ? `${a}||${b}` : `${b}||${a}`;

        pairFreq.set(key, (pairFreq.get(key) || 0) + w);
        coOpp.set(key, (coOpp.get(key) || 0) + w);
      }
    }
  }

  const streets = Array.from(streetFreq.keys()).sort();
  const pairs: PairOut[] = [];

  const totalSeen = Array.from(streetFreq.values()).reduce((acc, v) => acc + v, 0) || 1;
  const prob = new Map<string, number>();

  streets.forEach((s) => {
    prob.set(s, (streetFreq.get(s) || 0) / totalSeen);
  });

  for (const [key, sup] of pairFreq) {
    const [a, b] = key.split("||");

    const Pa = prob.get(a) || 1e-9;
    const Pb = prob.get(b) || 1e-9;
    const Pab = sup / totalSeen;
    const lift = Pab / (Pa * Pb);

    const opp = Math.max(1, Math.round(coOpp.get(key) || sup));
    const lb = wilsonLowerBound(Math.round(sup), opp, CONF_Z);

    if (sup >= MIN_SUPPORT && lift >= MIN_LIFT && lb >= 0.99) {
      pairs.push({
        a,
        b,
        support: Math.round(sup),
        lift: +lift.toFixed(3),
        confidence_lb: +lb.toFixed(3),
      });
    }
  }

  const nodes = new Set<string>();
  const edges: Array<[string, string]> = [];

  pairs.forEach((p) => {
    nodes.add(p.a);
    nodes.add(p.b);
    edges.push([p.a, p.b]);
  });

  const comps = components(Array.from(nodes), edges).filter((g) => g.length >= 2);

  const clusters = comps.map((group, idx) => ({
    id: `C${idx + 1}`,
    color: PALETTE[idx % PALETTE.length],
    streets: group,
  }));

  return {
    meta: {
      updatedAt: now.toISOString(),
      firstLearnAt,
      windowDays: WINDOW_DAYS,
      thresholds: {
        support: MIN_SUPPORT,
        lift: MIN_LIFT,
        confidence_lb: 0.99,
      },
      storage,
      logCount: entries.length,
    },
    pairs,
    clusters,
  };
}

function writePublicBackup(payload: BrianPayload) {
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
}

async function saveModelToDb(payload: BrianPayload) {
  try {
    const tenantId = await getTenantId();

    await brianDb.brianRouteModel.upsert({
      where: {
        tenantId_key: {
          tenantId,
          key: "current",
        },
      },
      update: {
        model: payload,
        stats: {
          pairs: payload.pairs.length,
          clusters: payload.clusters.length,
          logCount: payload.meta.logCount,
          storage: payload.meta.storage,
          updatedAt: payload.meta.updatedAt,
        },
        generatedAt: new Date(payload.meta.updatedAt),
      },
      create: {
        tenantId,
        key: "current",
        version: 1,
        model: payload,
        stats: {
          pairs: payload.pairs.length,
          clusters: payload.clusters.length,
          logCount: payload.meta.logCount,
          storage: payload.meta.storage,
          updatedAt: payload.meta.updatedAt,
        },
        generatedAt: new Date(payload.meta.updatedAt),
      },
      select: {
        id: true,
      },
    });

    return true;
  } catch (err) {
    console.error("❌ Brian model DB save failed:", err);
    return false;
  }
}

async function handle(request: Request) {
  const payload = await buildPayload();

  const fileBackupOk = writePublicBackup(payload);
  const dbSaveOk = await saveModelToDb(payload);

  const url = new URL(request.url);
  const wantsJson = url.searchParams.get("format") === "json";

  if (wantsJson) {
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json(
    {
      ok: true,
      storage: payload.meta.storage,
      dbModelSaved: dbSaveOk,
      fileBackupSaved: fileBackupOk,
      logs: payload.meta.logCount,
      pairs: payload.pairs.length,
      clusters: payload.clusters.length,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}

export async function GET(request: Request) {
  const authError = await requireAnySessionRole(request, ["admin", "tv"]);
  if (authError) return authError;

  const rateError = await enforceRateLimit(request, "brian:export", 10, 60_000);
  if (rateError) return rateError;

  return handle(request);
}

export async function POST(request: Request) {
  const authError = await requireMutationRole(request, ["admin", "tv"]);
  if (authError) return authError;

  const rateError = await enforceRateLimit(request, "brian:export", 10, 60_000);
  if (rateError) return rateError;

  return handle(request);
}