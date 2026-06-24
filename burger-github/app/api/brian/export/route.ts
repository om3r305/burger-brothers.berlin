// app/api/brian/export/route.ts
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data", "brian");
const LOG_FILE = path.join(DATA_DIR, "learn_log.jsonl");
const OUT_DIR = path.join(process.cwd(), "public", "data");
const OUT_FILE = path.join(OUT_DIR, "route_clusters.json");

// Defaults (Settings’ten ileride override edilir)
const WINDOW_DAYS = 60;
const MIN_SUPPORT = 12;
const MIN_LIFT = 1.5;
const CONF_Z = 2.576; // ~99%

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
    .replace(/\s+/g, " ")
    .replace(/\s+(\d+[a-zA-Z]?)\b/g, "") // son numara/ekleri nazikçe sil
    .replace(/\bstrasse\b/g, "straße")
    .trim();
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
  nodes.forEach(n => adj.set(n, new Set()));
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
      for (const v of (adj.get(u) || [])) {
        if (!seen.has(v)) { seen.add(v); stack.push(v); }
      }
    }
    if (group.length) comps.push(group.sort());
  }
  return comps;
}

const PALETTE = [
  "#22c55e","#a855f7","#3b82f6","#f59e0b",
  "#14b8a6","#6366f1","#84cc16","#06b6d4",
  "#d946ef","#10b981","#e11d48","#fb7185"
];

async function buildPayload() {
  const now = new Date();
  if (!fs.existsSync(LOG_FILE)) {
    return {
      meta: {
        updatedAt: now.toISOString(),
        firstLearnAt: null,
        windowDays: WINDOW_DAYS,
        thresholds: { support: MIN_SUPPORT, lift: MIN_LIFT, confidence_lb: 0.99 },
      },
      pairs: [] as Array<{a:string;b:string;support:number;lift:number;confidence_lb:number}>,
      clusters: [] as Array<{id:string;color:string;streets:string[]}>,
    };
  }

  const lines = fs.readFileSync(LOG_FILE, "utf8").split("\n").filter(Boolean);

  // sayımlar
  const streetFreq = new Map<string, number>();   // ağırlıklı tekil görülme
  const pairFreq = new Map<string, number>();     // ağırlıklı birliktelik
  const coOpp   = new Map<string, number>();      // fırsat tahmini (pair fırsatı)
  let firstLearnAt: string | null = null;

  for (const line of lines) {
    let entry: any;
    try { entry = JSON.parse(line); } catch { continue; }
    const t = entry?.occurredAt ? new Date(entry.occurredAt) : now;
    if (!firstLearnAt || +new Date(firstLearnAt) > +t) firstLearnAt = t.toISOString();

    const ageDays = daysBetween(now, t);
    if (ageDays > WINDOW_DAYS) continue;
    const w = decayForDays(ageDays);

    const streets: string[] = (Array.isArray(entry?.streets) ? entry.streets : []).map(normalizeStreet);
    const uniq = Array.from(new Set(streets)).filter(Boolean);

    // tekil frekans
    uniq.forEach(s => streetFreq.set(s, (streetFreq.get(s) || 0) + w));

    // pair frekans + fırsat
    for (let i = 0; i < uniq.length; i++) {
      for (let j = i + 1; j < uniq.length; j++) {
        const a = uniq[i], b = uniq[j];
        const key = a < b ? `${a}||${b}` : `${b}||${a}`;
        pairFreq.set(key, (pairFreq.get(key) || 0) + w);
        coOpp.set(key, (coOpp.get(key) || 0) + w);
      }
    }
  }

  // lift/confidence
  const streets = Array.from(streetFreq.keys()).sort();
  const pairs: Array<{a: string; b: string; support: number; lift: number; confidence_lb: number}> = [];

  // normalize için toplam ağırlık
  const totalSeen = Array.from(streetFreq.values()).reduce((acc, v) => acc + v, 0) || 1;
  const prob = new Map<string, number>();
  streets.forEach(s => prob.set(s, (streetFreq.get(s) || 0) / totalSeen));

  for (const [key, sup] of pairFreq) {
    const [a, b] = key.split("||");
    const Pa = prob.get(a) || 1e-9;
    const Pb = prob.get(b) || 1e-9;
    const Pab = sup / totalSeen;
    const lift = Pab / (Pa * Pb);

    const opp = Math.max(1, Math.round(coOpp.get(key) || sup));
    const lb = wilsonLowerBound(Math.round(sup), opp, CONF_Z);

    if (sup >= MIN_SUPPORT && lift >= MIN_LIFT && lb >= 0.99) {
      pairs.push({ a, b, support: Math.round(sup), lift: +lift.toFixed(3), confidence_lb: +lb.toFixed(3) });
    }
  }

  // graph & clusters
  const nodes = new Set<string>();
  const edges: Array<[string,string]> = [];
  pairs.forEach(p => { nodes.add(p.a); nodes.add(p.b); edges.push([p.a, p.b]); });

  const comps = components(Array.from(nodes), edges).filter(g => g.length >= 2);
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
      thresholds: { support: MIN_SUPPORT, lift: MIN_LIFT, confidence_lb: 0.99 },
    },
    pairs,
    clusters,
  };
}

async function handle(request: Request) {
  const payload = await buildPayload();

  // Lokal için dosyaya yazmayı dene (Vercel’de başarısız olabilir → sorun değil)
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2), "utf8");
  } catch {}

  const url = new URL(request.url);
  if (url.searchParams.get("format") === "json") {
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(
    { ok: true, pairs: payload.pairs.length, clusters: payload.clusters.length },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function GET(request: Request) { return handle(request); }
export async function POST(request: Request) { return handle(request); }
