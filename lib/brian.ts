/**
 * Brian — lightweight client inference for TV LED & group badge.
 * - Önce API'den çeker: /api/brian/export?format=json (no-store)
 * - Olmazsa fallback:   /public/data/route_clusters.json (no-store)
 *
 * Sunucu export iki şemayı da destekler:
 *  A) { updatedAt, windowDays, minSupport, minLift, pairs, clusters }
 *  B) { meta: { updatedAt, firstLearnAt, windowDays, thresholds:{ support, lift, confidence_lb } }, pairs, clusters }
 *
 * Sağladıkları:
 *  - loadBrian() → BrianData (cache’li)
 *  - normalizeStreet(str) → string
 *  - clusterColorOf(street, data?) → string | null
 *  - clusterIdOf(street, data?) → string | null
 *  - analyze(street, peers, data?, gateOn?) → { led: 'green'|'red'|'gray', clusterId?, clusterColor? }
 *  - buildLegend(data, max) → {id,color,size,example}[]
 *  - groupByCluster(streets, data) → { [clusterIdOr__none]: string[] }
 *  - brianIsActive(meta, cfg) → boolean   // 1 ay kapısı için
 *  - groupByPeers(streets, data?, gateOn?) → BrianGroup[] // A/B/C… renkli gruplar
 *  - groupOfStreet(street, groups) → BrianGroup|null
 */

export type BrianPair = {
  a: string;
  b: string;
  support: number;
  lift: number;
  confidence_lb: number;
  negative?: boolean; // opsiyonel: negatif eşleşme
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
    thresholds?: { support: number; lift: number; confidence_lb: number };
  };
  clusters: BrianCluster[];
  pairs: BrianPair[];
};

let cache: BrianData | null = null;
let pending: Promise<BrianData> | null = null;

/** TV/Export ile birebir normalize — diacritics, boşluk, virgül sonrası, kapı no vs. */
export function normalizeStreet(raw: string): string {
  if (!raw) return "";
  let s = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, ""); // diacritics temizle

  // virgül varsa ilk parça (örn: "Lübecker Str., 12 Berlin" → "lübecker str.")
  s = s.split(",")[0];

  // strasse → straße (Almanca varyant)
  s = s.replace(/strasse/g, "straße");

  // sonda kapı no (örn "reinickendorfer str 12a")
  s = s.replace(/\s+\d+[a-z]?\b/gi, "");

  // fazla boşluklar
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/** Export’tan dahil edilen eşik/threshold’ları esnekçe topla */
function resolveThresholds(d: any) {
  const meta = d?.meta || {};
  const thr = meta?.thresholds || {};
  const support = Number(thr?.support ?? d?.minSupport ?? 12);
  const lift = Number(thr?.lift ?? d?.minLift ?? 1.5);
  const confidence_lb = Number(thr?.confidence_lb ?? 0.99);
  return { support, lift, confidence_lb };
}

/** Export tarihini number’a normalize et (opsiyonel) */
function resolveUpdatedAt(d: any): number | undefined {
  if (d?.meta?.updatedAt != null) {
    const v = d.meta.updatedAt;
    return typeof v === "number" ? v : (Date.parse(v) || undefined);
  }
  if (d?.updatedAt) {
    return Date.parse(d.updatedAt) || undefined;
  }
  return undefined;
}

/** JSON → BrianData’e normalize */
function toBrianData(raw: any): BrianData {
  const thresholds = resolveThresholds(raw);
  const updatedAt = resolveUpdatedAt(raw);
  const windowDays = Number(raw?.windowDays ?? raw?.meta?.windowDays ?? 60);

  const pairs: BrianPair[] = Array.isArray(raw?.pairs) ? raw.pairs : [];
  const clusters: BrianCluster[] = Array.isArray(raw?.clusters) ? raw.clusters : [];

  // streets normalize et (güvenlik)
  for (const c of clusters) {
    c.streets = (c.streets || []).map(normalizeStreet);
  }

  return {
    meta: {
      updatedAt,
      firstLearnAt: raw?.meta?.firstLearnAt ?? null,
      windowDays,
      thresholds,
    },
    pairs,
    clusters,
  };
}

/** Brian modelini yükler: API-first, sonra public dosya (no-store), cache’ler */
export async function loadBrian(): Promise<BrianData> {
  if (cache) return cache;
  if (!pending) {
    const ts = Date.now();
    pending = fetch(`/api/brian/export?format=json&ts=${ts}`, { cache: "no-store" })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .catch(() => fetch(`/data/route_clusters.json?ts=${ts}`, { cache: "no-store" }).then(r => r.json()))
      .catch(() => ({ clusters: [], pairs: [] } as BrianData))
      .then((raw) => {
        const d = toBrianData(raw || {});
        cache = d;
        pending = null;
        return d;
      });
  }
  return pending;
}

/** Street → cluster color */
export function clusterColorOf(street: string, data?: BrianData | null): string | null {
  const d = data || cache;
  if (!d) return null;
  const s = normalizeStreet(street);
  for (const c of d.clusters || []) {
    if ((c.streets || []).includes(s)) return c.color || null;
  }
  return null;
}

/** Street → cluster id */
export function clusterIdOf(street: string, data?: BrianData | null): string | null {
  const d = data || cache;
  if (!d) return null;
  const s = normalizeStreet(street);
  for (const c of d.clusters || []) {
    if ((c.streets || []).includes(s)) return c.id || null;
  }
  return null;
}

/* ───────────────────────────── 1 AY KAPISI ───────────────────────────── */

export type BrianGateConfig = {
  host?: string;             // window.location.host (veya req Host)
  goLiveAt?: string;         // ISO prod yayına çıkış tarihi
  enableAfterDays?: number;  // default 30
  allowedHosts?: string[];   // sadece bu hostlarda sayaç işler
  force?: "on" | "off";      // test override
};

function daysDiff(a: Date, b: Date) {
  return Math.floor((+a - +b) / (1000 * 60 * 60 * 24));
}

/** 1 ay kapısı: aktifse true döner, değilse false (öğrenme modu) */
export function brianIsActive(meta: BrianData["meta"], cfg: BrianGateConfig = {}): boolean {
  if (cfg.force === "on") return true;
  if (cfg.force === "off") return false;

  const allowed = cfg.allowedHosts && cfg.allowedHosts.length
    ? !!cfg.allowedHosts.find(h => h.toLowerCase() === (cfg.host || "").toLowerCase())
    : true;
  if (!allowed) return false;

  const enableAfter = Number.isFinite(cfg.enableAfterDays as any) ? (cfg.enableAfterDays as number) : 30;

  // Sayaç başlangıcı: önce goLiveAt; yoksa firstLearnAt
  const startIso = cfg.goLiveAt || meta?.firstLearnAt || null;
  if (!startIso) return false;

  const start = new Date(startIso);
  const now = new Date();
  return daysDiff(now, start) >= enableAfter;
}

/* ───────────────────────────── LED ANALİZ ───────────────────────────── */

/** Basit peer tabanlı LED:
 *  - GREEN: (street, peer) çifti thresholds’u geçiyorsa → onaylı iyi eşleşme
 *  - RED:   (negatif flag varsa ve güven yüksekse)
 *  - GRAY:  yeterli veri yok / eşik altı veya gate kapalı
 *
 *  gateOn=false verilirse (öğrenme modu): yeşiller GRAY zorlanır, RED korunur.
 */
export function analyze(
  street: string,
  peers: string[],
  data?: BrianData | null,
  gateOn: boolean = true
): { led: 'green'|'red'|'gray', clusterId?: string, clusterColor?: string } {
  const d = data || cache;
  if (!d) return { led: 'gray' };

  const s = normalizeStreet(street);
  const normPeers = (peers || []).map(normalizeStreet).filter(p => p && p !== s);
  const color = clusterColorOf(s, d) || undefined;
  const cid = clusterIdOf(s, d) || undefined;

  if (!s || normPeers.length === 0) {
    return { led: 'gray', clusterId: cid, clusterColor: color };
  }

  const th = resolveThresholds(d);

  let good = false;
  let bad = false;

  for (const p of d.pairs || []) {
    const hit =
      (p.a === s && normPeers.includes(p.b)) ||
      (p.b === s && normPeers.includes(p.a));
    if (!hit) continue;

    const supportOk = (p.support ?? 0) >= th.support;
    const liftOk = (p.lift ?? 0) >= th.lift;
    const confOk = (p.confidence_lb ?? 0) >= th.confidence_lb;

    if (p.negative) {
      if (confOk) bad = true;
    } else {
      if (supportOk && liftOk && confOk) good = true;
    }

    if (good || bad) break;
  }

  // Kapı kapalıysa pozitif önerileri GRAY’a zorla; RED korunur
  if (!gateOn) {
    return { led: bad ? 'red' : 'gray', clusterId: cid, clusterColor: color };
  }

  const led: 'green'|'red'|'gray' = bad ? 'red' : (good ? 'green' : 'gray');
  return { led, clusterId: cid, clusterColor: color };
}

/* ───────────────────────────── Legend & Cluster Group ───────────────────────────── */

export function buildLegend(data?: BrianData | null, max = 8): Array<{ id: string; color: string; size: number; example?: string }> {
  const d = data || cache;
  if (!d) return [];
  const items = (d.clusters || [])
    .map(c => ({
      id: c.id,
      color: c.color || "#9ca3af",
      size: (c.streets || []).length,
      example: c.streets?.[0]
    }))
    .sort((a, b) => b.size - a.size)
    .slice(0, Math.max(1, max));
  return items;
}

/** Ekrandaki sokakları cluster’lara ayır (TV’de gruplu gösterim için yardımcı) */
export function groupByCluster(streets: string[], data?: BrianData | null): Record<string, string[]> {
  const d = data || cache;
  const out: Record<string, string[]> = {};
  const otherKey = "__none";

  for (const raw of (streets || [])) {
    const s = normalizeStreet(raw);
    const cid = d ? (clusterIdOf(s, d) || otherKey) : otherKey;
    if (!out[cid]) out[cid] = [];
    out[cid].push(raw); // orijinali döndürüyoruz
  }
  return out;
}

/* ───────────────────────────── A/B/C Grup Renklendirme ───────────────────────────── */

const GROUP_PALETTE = [
  "#22c55e", // green
  "#a855f7", // purple
  "#3b82f6", // blue
  "#f59e0b", // amber
  "#14b8a6", // teal
  "#6366f1", // indigo
  "#84cc16", // lime
  "#06b6d4", // cyan
  "#d946ef", // fuchsia
];

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return Math.abs(h | 0);
}

type Thresholds = { support: number; lift: number; confidence_lb: number };

function meetsPositive(p: BrianPair, th: Thresholds): boolean {
  if (p.negative) return false;
  return (p.support ?? 0) >= th.support
    && (p.lift ?? 0) >= th.lift
    && (p.confidence_lb ?? 0) >= th.confidence_lb;
}

export type BrianGroup = {
  id: string;        // stabil id (hash)
  label: string;     // A, B, C...
  color: string;     // tekler gri (gate kapalıysa tümü gri)
  size: number;      // kaç sokak
  streets: string[]; // normalize sokaklar
  example?: string;  // gösterim için
};

/** Ekrandaki sokaklardan (pozitif eşleşen) bağlı bileşenleri çıkar ve renklendir */
export function groupByPeers(streets: string[], data?: BrianData | null, gateOn: boolean = true): BrianGroup[] {
  const d = data || cache;
  if (!d) return [];
  const th = resolveThresholds(d);
  const S = Array.from(new Set(streets.map(normalizeStreet).filter(Boolean)));

  // eşik üstü pozitif kenarlar
  const pos = new Set<string>();
  for (const p of d.pairs || []) {
    const a = p.a, b = p.b;
    if (!a || !b) continue;
    if (!S.includes(a) || !S.includes(b)) continue;
    if (meetsPositive(p, th)) {
      const key = a < b ? `${a}||${b}` : `${b}||${a}`;
      pos.add(key);
    }
  }

  // adjacency
  const adj = new Map<string, Set<string>>();
  S.forEach(s => adj.set(s, new Set()));
  for (const k of pos) {
    const [a, b] = k.split("||");
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  }

  // DFS bileşenler
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
        if (!seen.has(nb)) { seen.add(nb); st.push(nb); }
      }
    }
    comps.push(g.sort());
  }

  // büyükten küçüğe sırala
  comps.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));

  // label’lar: A, B, C...
  const labels = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  return comps.map((g, i) => {
    const key = g.join("|");
    const h = hashString(key);
    // gate kapalıysa tüm gruplar gri; açık ve size>=2 ise palette
    const color = (!gateOn || g.length < 2) ? "#9ca3af" : GROUP_PALETTE[h % GROUP_PALETTE.length];
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

/** Sokağın ait olduğu grup (varsa) */
export function groupOfStreet(street: string, groups: BrianGroup[]): BrianGroup | null {
  const s = normalizeStreet(street);
  for (const g of groups) if (g.streets.includes(s)) return g;
  return null;
}
