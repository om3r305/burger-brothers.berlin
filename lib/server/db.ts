// lib/server/db.ts
import fs from "fs";
import path from "path";

/** Verileri saklamak için olası dizinler (ilk yazılabilen kullanılır). */
const DATA_DIRS = [
  path.join(process.cwd(), ".data"),
  path.join(process.cwd(), "data"),
  "/tmp",
];

const FILE_NAME = "orders.json";

/* ───────────────── types ───────────────── */

export type OrderChannel = "liferando" | "apollo" | "web";
export type OrderMode = "pickup" | "delivery";

/** Genişletilmiş durum akışı (pickup/delivery ortak) */
export type OrderStatus =
  | "received"       // alındı
  | "preparing"      // hazırlanıyor
  | "ready"          // abholbereit (pickup) / teslimata hazır
  | "on_the_way"     // yolda (delivery)
  | "delivered"      // teslim edildi (delivery)
  | "completed";     // arşiv/kapanış

export type StatusHistoryItem = {
  status: OrderStatus;
  at: number; // epoch ms
};

export type StoredOrder = {
  id: string;
  status: OrderStatus;
  createdAt: number;
  updatedAt?: number;
  completedAt?: number;
  etaMin?: number;
  /** Opsiyonel meta */
  channel?: OrderChannel;
  mode?: OrderMode;
  /** Orijinal sipariş payload’ı */
  order: any;
  /** Durum geçmişi */
  history?: StatusHistoryItem[];
};

/* ───────────────── fs helpers ───────────────── */

function ensureDir(): string {
  for (const d of DATA_DIRS) {
    try {
      fs.mkdirSync(d, { recursive: true });
      return d;
    } catch {}
  }
  return "/tmp";
}

function filePath(): string {
  const dir = ensureDir();
  return path.join(dir, FILE_NAME);
}

/** Atomic write: önce .tmp, sonra rename */
function writeJsonAtomic(targetPath: string, data: unknown) {
  const tmpPath = `${targetPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmpPath, targetPath);
}

/* ───────────────── date helpers (Europe/Berlin) ───────────────── */

/** Europe/Berlin için bugünün başlangıcı (ms) */
function startOfTodayBerlin(): number {
  const tz = "Europe/Berlin";
  const now = new Date();
  const parts = new Intl.DateTimeFormat("de-DE", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value;
      return acc;
    }, {});
  const y = Number(parts.year);
  const m = Number(parts.month);
  const d = Number(parts.day);
  // Yerel Berlin gününün 00:00’ını üret
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:00:00`;
  // O saati Berlin’e göre epoch’a çevir
  const berlinMidnight = new Date(
    new Date(iso + "Z").toLocaleString("en-US", { timeZone: tz })
  );
  return berlinMidnight.getTime();
}

function endOfTodayBerlin(): number {
  return startOfTodayBerlin() + 24 * 60 * 60 * 1000 - 1;
}

/* ───────────────── core IO ───────────────── */

export function readAll(): StoredOrder[] {
  const p = filePath();
  try {
    const txt = fs.readFileSync(p, "utf8");
    const arr = JSON.parse(txt);
    return Array.isArray(arr) ? (arr as StoredOrder[]) : [];
  } catch {
    return [];
  }
}

export function writeAll(list: StoredOrder[]) {
  const p = filePath();
  try {
    writeJsonAtomic(p, list);
  } catch {}
}

/* ───────────────── mapping & merge ───────────────── */

const legacyToNewStatus: Record<string, OrderStatus | undefined> = {
  // mevcut koddaki statüler geriye dönük desteklensin
  received: "received",
  preparing: "preparing",
  ready: "ready",
  completed: "completed",
  // bazı olası varyasyonlar:
  in_progress: "preparing",
  done: "completed",
};

function normalizeStatus(s: string): OrderStatus {
  return (
    legacyToNewStatus[s] ||
    (["on_the_way", "delivered"].includes(s) ? (s as OrderStatus) : "received")
  );
}

function pushHistory(o: StoredOrder, status: OrderStatus, at: number) {
  if (!o.history) o.history = [];
  // Aynı statüyü üst üste kaydetme (gereksiz artışı engelle)
  const last = o.history[o.history.length - 1];
  if (!last || last.status !== status) {
    o.history.push({ status, at });
  }
}

/* ───────────────── CRUD-like helpers ───────────────── */

export function upsert(o: StoredOrder) {
  const list = readAll();
  const i = list.findIndex((x) => x.id === o.id);
  const now = Date.now();

  // normalize status & history
  o.status = normalizeStatus(o.status);
  o.updatedAt = now;
  if (!o.history || o.history.length === 0) {
    o.history = [{ status: o.status, at: o.createdAt || now }];
  } else {
    pushHistory(o, o.status, now);
  }
  if (o.status === "completed") o.completedAt = o.completedAt || now;

  if (i >= 0) {
    // merge (order içindeki alanlar korunur, yeni alanlar güncellenir)
    const prev = list[i];
    const merged: StoredOrder = {
      ...prev,
      ...o,
      order: o.order ?? prev.order,
      history: [...(prev.history || []), ...(o.history || [])],
    };
    list[i] = merged;
  } else {
    list.push(o);
  }
  writeAll(list);
}

export function upsertMany(arr: StoredOrder[]) {
  if (!Array.isArray(arr) || arr.length === 0) return;
  const list = readAll();
  const now = Date.now();

  for (const o of arr) {
    const idx = list.findIndex((x) => x.id === o.id);
    o.status = normalizeStatus(o.status);
    o.updatedAt = now;
    if (!o.history || o.history.length === 0) {
      o.history = [{ status: o.status, at: o.createdAt || now }];
    } else {
      pushHistory(o, o.status, now);
    }
    if (o.status === "completed") o.completedAt = o.completedAt || now;

    if (idx >= 0) {
      const prev = list[idx];
      list[idx] = {
        ...prev,
        ...o,
        order: o.order ?? prev.order,
        history: [...(prev.history || []), ...(o.history || [])],
      };
    } else {
      list.push(o);
    }
  }

  writeAll(list);
}

export function updateStatus(id: string, status: OrderStatus | string) {
  const list = readAll();
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return;
  const now = Date.now();
  const st = normalizeStatus(status);

  list[i].status = st;
  list[i].updatedAt = now;
  pushHistory(list[i], st, now);
  if (st === "completed") list[i].completedAt = now;
  writeAll(list);
}

export function setEta(id: string, etaMin: number | undefined) {
  const list = readAll();
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return;
  list[i].etaMin = etaMin;
  list[i].updatedAt = Date.now();
  writeAll(list);
}

export function setChannelAndMode(
  id: string,
  channel?: OrderChannel,
  mode?: OrderMode
) {
  const list = readAll();
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return;
  if (channel) list[i].channel = channel;
  if (mode) list[i].mode = mode;
  list[i].updatedAt = Date.now();
  writeAll(list);
}

export function getById(id: string): StoredOrder | null {
  return readAll().find((x) => x.id === id) || null;
}

/* ───────────────── querying helpers ───────────────── */

export function readByDateRange(startMs: number, endMs: number): StoredOrder[] {
  return readAll().filter(
    (x) => x.createdAt >= startMs && x.createdAt <= endMs
  );
}

export function readToday(): StoredOrder[] {
  const s = startOfTodayBerlin();
  const e = endOfTodayBerlin();
  return readByDateRange(s, e);
}

/** Bugün dışındakileri atar (kalıcı temizlik) */
export function pruneHinweisToday() {
  const s = startOfTodayBerlin();
  const e = endOfTodayBerlin();
  const today = readByDateRange(s, e);
  writeAll(today);
}

/** Aktif (completed dışındakiler) */
export function readActiveToday(): StoredOrder[] {
  return readToday().filter((x) => x.status !== "completed");
}

/** Tamamlananlar (bugün) */
export function readCompletedToday(): StoredOrder[] {
  return readToday().filter((x) => x.status === "completed");
}

/** Kanal kırılımı (bugün) */
export function countsByChannelToday(): Record<OrderChannel, number> {
  const base: Record<OrderChannel, number> = { liferando: 0, apollo: 0, web: 0 };
  for (const o of readToday()) {
    const ch = (o.channel || "web") as OrderChannel;
    if (base[ch] != null) base[ch]++;
  }
  return base;
}

export function usingSQLite(): boolean {
  return !!(sqlite && process.env.DB_SQLITE_FILE);
}

function sql() {
  if (!usingSQLite()) return null;
  const Database = sqlite;
  const db = new Database(process.env.DB_SQLITE_FILE as string);
  db.pragma("journal_mode = WAL");
  db.exec(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)`);
  return db;
}

function sqlGet(db: any, k: string, fallback: any) {
  const row = db.prepare("SELECT v FROM kv WHERE k = ?").get(k);
  return row ? JSON.parse(row.v) : fallback;
}
function sqlSet(db: any, k: string, v: any) {
  db.prepare("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(k, JSON.stringify(v));
}

function usingPrisma(): boolean {
  return !!(prisma && process.env.DATABASE_URL);
}

function prismaClient() {
  if (!usingPrisma()) return null;
  const { PrismaClient } = prisma;
  // @ts-ignore
  globalThis.__prisma = globalThis.__prisma || new PrismaClient();
  // @ts-ignore
  return globalThis.__prisma as InstanceType<typeof PrismaClient>;
}

export const DBA = {
  async read(key: string, fallback: any) {
    if (usingPrisma()) {
      const db = prismaClient();
      const row = await db.kV.findUnique({ where: { k: key } });
      return row ? JSON.parse(row.v) : fallback;
    }
    if (usingSQLite()) {
      const db = sql();
      if (db) return sqlGet(db, key, fallback);
    }
    return readJSON(key, fallback);
  },
  async write(key: string, data: any) {
    if (usingPrisma()) {
      const db = prismaClient();
      await db.kV.upsert({ where: { k: key }, update: { v: JSON.stringify(data) }, create: { k: key, v: JSON.stringify(data) } });
      return;
    }
    if (usingSQLite()) {
      const db = sql();
      if (db) return sqlSet(db, key, data);
    }
    return writeJSON(key, data);
  }
};

export function currentMode(): "prisma" | "sqlite" | "json" {
  if (usingPrisma()) return "prisma";
  if (usingSQLite()) return "sqlite";
  return "json";
}
