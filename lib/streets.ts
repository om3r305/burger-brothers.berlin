// lib/streets.ts
/*  ─────────────────────────────────────────────────────────────
    Berlin PLZ → Straße listesi yardımcıları
    - Primary kaynak: public/data/streets.json
    - Cache: localStorage ("bb_streets_v1")
    - İlk kullanımda otomatik hydrate (lazy)
    - Akıllı arama: normalize + includes
    - POI/işletme isimlerini ELE
    ───────────────────────────────────────────────────────────── */

export type StreetDB = Record<string, string[]>;

export const LS_STREETS = "bb_streets_v1";

/** Dükkan konumu (Tegel) ve teslimat yarıçapı */
export const SHOP_COORD = { lat: 52.5865, lon: 13.2862 };
export const DELIVERY_RADIUS_KM = 8;

/* RAM kopyası */
let STREET_DB: StreetDB = {};
let HYDRATE_STARTED = false;

/* ───────────── yardımcılar ───────────── */

function tryParse<T>(s: any, fb: T): T {
  try { const v = JSON.parse(String(s)); return (v ?? fb) as T; } catch { return fb; }
}

function saveToLS(db: StreetDB) {
  try { localStorage.setItem(LS_STREETS, JSON.stringify(db)); } catch {}
}

function loadFromLS(): StreetDB {
  try {
    const raw = localStorage.getItem(LS_STREETS);
    return raw ? tryParse<StreetDB>(raw, {}) : {};
  } catch { return {}; }
}

function plz5(v?: string | null): string {
  return String(v || "").replace(/[^\d]/g, "").slice(0, 5);
}

export function setStreetDB(db: StreetDB) {
  // hepsini normalize ederek POI’leri ele, tekrar yaz
  const cleaned: StreetDB = {};
  for (const plz of Object.keys(db || {})) {
    const list = Array.isArray(db[plz]) ? db[plz] : [];
    const uniq = new Set<string>();
    for (const name of list) {
      if (!name) continue;
      if (!isLikelyStreetName(name)) continue;           // ← POI’leri at
      const trimmed = beautify(name);
      if (trimmed) uniq.add(trimmed);
    }
    cleaned[plz] = Array.from(uniq).sort((a, b) => a.localeCompare(b, "de"));
  }
  STREET_DB = cleaned;
  saveToLS(STREET_DB);
}

export function getStreetDB(): StreetDB {
  if (Object.keys(STREET_DB).length) return STREET_DB;
  // önce LS dene
  STREET_DB = loadFromLS();
  // LS boşsa lazy hydrate başlat
  ensureHydrated();
  return STREET_DB;
}

/** Tek bir PLZ için sokak listesi (temizlenmiş) */
export function getStreets(plz?: string | null): string[] {
  const code = plz5(plz);
  if (!code) return [];
  const db = getStreetDB();
  const raw = Array.isArray(db?.[code]) ? db[code] : [];
  // DB boşsa ilk çağrıda hydrate başlatılmış olur; kısa süre boş dönebilir.
  return raw.filter(isLikelyStreetName);
}

/** Harfleri normalize et (ä→ae, ö→oe, ü→ue, ß→ss, aksanları at) */
export function normalize(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** “Gerçek sokak adına benziyor mu?” — allowlist + denylist */
export function isLikelyStreetName(name: string): boolean {
  const n = normalize(name);

  // tipik son ekler + bazı önekler
  const streetType = /(strasse|straße|allee|damm|weg|platz|ufer|gasse|zeile|chaussee|ring|steig|stieg|pfad|promenade|bruecke|brücke|kai|bogen|winkel|grund|anger|markt)$/i;
  const prefixes = /^(am|an|auf|in|zum|zur|zu|alt|neu)\s/i;

  const looksStreet = streetType.test(n) || prefixes.test(n);

  // işletme/POI kara listesi
  const poiBad = [
    "gmbh","logistics","apotheke","hotel","schule","kita","kindergarten","werkstatt","autohaus",
    "shisha","lounge","pizzeria","kiosk","bar","restaurant","supermarkt","markt","lidl","aldi",
    "netto","rewe","edeka","dm","rossmann","fitness","studio","praxis","klinik","arzt",
    "zentrum","halle","werk","werks","bahnhof","campus","universitaet","universität",
    "lager","depot","parkplatz","parkcenter","passage"
  ];
  if (poiBad.some((w) => n.includes(w))) return false;

  // çok kısa tek kelime ve tip yoksa at
  if (n.split(" ").length === 1 && !streetType.test(n)) return false;

  return looksStreet;
}

/** Görsel güzelleştirme: baş harfler büyük, ekstra boşluklar silinir */
export function beautify(s: string): string {
  const t = (s || "").replace(/\s+/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}

/** Akıllı arama (normalize + includes; POI’ler zaten elenmiş) */
export function searchStreets(plz?: string | null, q?: string, limit = 50): string[] {
  const list = getStreets(plz).filter(isLikelyStreetName);
  const term = normalize(q || "");
  if (!term) return list.slice(0, limit);
  const out: string[] = [];
  for (const name of list) {
    if (normalize(name).includes(term)) {
      out.push(name);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/* ───────────── JSON yükleme (public/) ───────────── */
async function fetchJSONFromPublic(): Promise<StreetDB> {
  if (typeof window !== "undefined") {
    // client
    const res = await fetch("/data/streets.json", { cache: "force-cache" });
    if (!res.ok) throw new Error("streets.json not found in /public/data");
    return (await res.json()) as StreetDB;
  } else {
    // server (SSR)
    const fs = await import("fs/promises");
    const path = await import("path");
    const file = path.join(process.cwd(), "public", "data", "streets.json");
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as StreetDB;
  }
}

/** Elle çağırmak istersen (örn. Checkout’ta) */
export async function hydrateFromBundledJSON(): Promise<void> {
  try {
    const json = await fetchJSONFromPublic();
    if (json && typeof json === "object") setStreetDB(json);
  } catch {/* yoksa sessizce geç */}
}

/** DB boşsa, ilk istekte hydrate başlat. */
function ensureHydrated() {
  if (HYDRATE_STARTED) return;
  const empty = Object.keys(STREET_DB || {}).length === 0;
  if (empty) {
    HYDRATE_STARTED = true;
    // fire-and-forget; yüklenince LS+RAM dolar
    hydrateFromBundledJSON().finally(() => {
      HYDRATE_STARTED = false;
    });
  }
}

/* ───────────── mesafe hesabı (opsiyonel) ───────────── */
export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function withinRadiusKm(coord: { lat: number; lon: number }, km = DELIVERY_RADIUS_KM): boolean {
  return haversineKm(SHOP_COORD, coord) <= km;
}

/** Dışarıdan JSON string verip import etmek istersen */
export function importFromJSONString(jsonString: string) {
  const db = tryParse<StreetDB>(jsonString, {});
  setStreetDB(db); // temizlik burada da çalışır
}

/* Varsayılan API (istenirse toplu import) */
const StreetsAPI = {
  LS_STREETS,
  SHOP_COORD,
  DELIVERY_RADIUS_KM,
  getStreetDB,
  setStreetDB,
  getStreets,
  searchStreets,
  hydrateFromBundledJSON,
  normalize,
  beautify,
  isLikelyStreetName,
  haversineKm,
  withinRadiusKm,
  importFromJSONString,
};
export default StreetsAPI;

/* ───────────────────────────────────────────
 * COMPAT LAYER — admin/addresses/page.tsx için
 * (mevcut API’yı bozmadan eski isimleri sağlar)
 * ─────────────────────────────────────────── */

export function readStreetDB(): StreetDB {
  return getStreetDB();
}

export function writeStreetDB(db: StreetDB): StreetDB {
  setStreetDB(db);
  return getStreetDB();
}

export function filterStreets(plz: string, q: string): string[] {
  return searchStreets(plz, q);
}

export function replacePLZ(plz: string, streets: string[]): StreetDB {
  const code = plz5(plz);
  if (code.length !== 5) return getStreetDB();

  const cur = { ...getStreetDB() };
  const cleaned = Array.from(
    new Set((streets || [])
      .map((s) => beautify(String(s)))
      .filter(isLikelyStreetName))
  ).sort((a, b) => a.localeCompare(b, "de"));

  cur[code] = cleaned;
  setStreetDB(cur);
  return cur;
}

export function upsertPLZ(plz: string, add: string[]): StreetDB {
  const code = plz5(plz);
  if (code.length !== 5) return getStreetDB();

  const cur = { ...getStreetDB() };
  const base = new Set(cur[code] || []);
  for (const s of add || []) {
    const v = beautify(String(s));
    if (isLikelyStreetName(v)) base.add(v);
  }
  cur[code] = Array.from(base).sort((a, b) => a.localeCompare(b, "de"));
  setStreetDB(cur);
  return cur;
}

export function removePLZ(plz: string): StreetDB {
  const code = plz5(plz);
  if (!code) return getStreetDB();
  const cur = { ...getStreetDB() };
  delete cur[code];
  setStreetDB(cur);
  return cur;
}

/** CSV import/export — admin ekranının beklediği imzalar */
export function importCSVToPLZ(csv: string): StreetDB | string[] {
  const text = String(csv || "").replace(/\r/g, "");
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  // Ayırıcıyı satır bazında belirle
  const splitSmart = (s: string) => {
    const semi = s.split(";");
    const comma = s.split(",");
    return semi.length >= comma.length ? semi : comma;
  };

  // Kolon sayısını tahmin et
  const firstCols = splitSmart(lines[0]).length;

  if (firstCols < 2) {
    // Tek kolon: sokak listesi döndür (seçili PLZ ile replacePLZ kullanılacak)
    const only = Array.from(
      new Set(lines.map((l) => beautify(splitSmart(l)[0] || "")).filter(isLikelyStreetName))
    ).sort((a, b) => a.localeCompare(b, "de"));
    return only;
  }

  // Çok kolon: (plz, street) → tüm DB’yi yaz ve döndür
  const next: StreetDB = {};
  for (const l of lines) {
    const cols = splitSmart(l).map((c) => c.trim());
    const code = plz5(cols[0] || "");
    const street = beautify(cols[1] || "");
    if (code.length !== 5 || !isLikelyStreetName(street)) continue;
    if (!next[code]) next[code] = [];
    next[code].push(street);
  }
  setStreetDB(next);
  return getStreetDB();
}

export function exportCSV(db: StreetDB): string {
  const safe = Object.keys(db || {}).length ? db : getStreetDB();
  const rows: string[] = ["plz;street"];
  for (const code of Object.keys(safe).sort()) {
    for (const s of safe[code]) {
      const cell = s.includes(";") || s.includes(",") ? `"${s.replace(/"/g, '""')}"` : s;
      rows.push(`${code};${cell}`);
    }
  }
  return rows.join("\n");
}
