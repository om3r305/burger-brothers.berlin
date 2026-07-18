// lib/server/fallback-snapshot.ts
import { promises as fs } from "fs";
import path from "path";

type SnapshotName = "catalog" | "products" | "settings" | string;

type SnapshotEnvelope<T = any> = {
  version: 1;
  name: string;
  updatedAt: string;
  updatedAtMs: number;
  data: T;
};

type SnapshotWriteResult = {
  ok: boolean;
  key: string;
  updatedAt?: string;
  stores: {
    kv: boolean;
    local: boolean;
  };
  skipped?: boolean;
  reason?: string;
};

const SNAPSHOT_VERSION = 1;

function cleanSnapshotName(name: SnapshotName) {
  return String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function snapshotNamespace() {
  return (
    process.env.FALLBACK_SNAPSHOT_NAMESPACE ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL ||
    "burger-brothers-berlin"
  )
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .slice(0, 120);
}

function snapshotKey(name: SnapshotName) {
  const cleanName = cleanSnapshotName(name) || "snapshot";
  return `bb:${snapshotNamespace()}:fallback:${cleanName}`;
}

function isPlainObject(value: any): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sanitizeJson(value: any): any {
  if (value === undefined) return null;
  if (value === null) return null;

  if (value instanceof Date) {
    return Number.isFinite(value.valueOf()) ? value.toISOString() : null;
  }

  if (
    value &&
    typeof value === "object" &&
    typeof value.toNumber === "function" &&
    typeof value.toString === "function"
  ) {
    try {
      return value.toNumber();
    } catch {
      return value.toString();
    }
  }

  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return null;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJson(item));
  }

  if (isPlainObject(value)) {
    const out: Record<string, any> = {};

    for (const [key, item] of Object.entries(value)) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") continue;
      if (item === undefined) continue;
      out[key] = sanitizeJson(item);
    }

    return out;
  }

  return value;
}

function extractArray(value: any, keys: string[]) {
  if (Array.isArray(value)) return value;

  if (!isPlainObject(value)) return [];

  for (const key of keys) {
    const candidate = value[key];
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

function isUsableSnapshotData(name: SnapshotName, data: any) {
  const cleanName = cleanSnapshotName(name);

  if (cleanName === "catalog") {
    return extractArray(data, ["products", "items"]).length > 0;
  }

  if (cleanName === "products") {
    return extractArray(data, ["items", "products"]).length > 0;
  }

  if (cleanName === "settings") {
    return isPlainObject(data) && Object.keys(data).length > 0;
  }

  return data !== undefined && data !== null;
}

function envelopeData<T>(value: any): T | null {
  if (!value) return null;

  if (isPlainObject(value) && value.version === SNAPSHOT_VERSION && "data" in value) {
    return value.data as T;
  }

  return value as T;
}

function kvConfig() {
  const url =
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.FALLBACK_KV_REST_URL ||
    "";

  const token =
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.FALLBACK_KV_REST_TOKEN ||
    "";

  if (!url || !token) return null;

  return {
    url: url.replace(/\/+$/, ""),
    token,
  };
}

export function hasPersistentFallbackStore() {
  return Boolean(kvConfig());
}

async function kvCommand(args: any[]) {
  const cfg = kvConfig();
  if (!cfg) throw new Error("KV_NOT_CONFIGURED");

  const response = await fetch(cfg.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${cfg.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(`KV_HTTP_${response.status}`);
  }

  if (payload?.error) {
    throw new Error(String(payload.error));
  }

  return payload?.result;
}

function localSnapshotDir() {
  if (process.env.FALLBACK_SNAPSHOT_DIR) {
    return process.env.FALLBACK_SNAPSHOT_DIR;
  }

  if (process.env.VERCEL) {
    return path.join("/tmp", "burger-brothers-fallback-snapshots");
  }

  return path.join(process.cwd(), ".burger-brothers-fallback-snapshots");
}

function localSnapshotPath(name: SnapshotName) {
  return path.join(localSnapshotDir(), `${cleanSnapshotName(name) || "snapshot"}.json`);
}

async function readLocalSnapshot<T>(name: SnapshotName): Promise<T | null> {
  try {
    const file = localSnapshotPath(name);
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    return envelopeData<T>(parsed);
  } catch {
    return null;
  }
}

async function writeLocalSnapshot<T>(name: SnapshotName, envelope: SnapshotEnvelope<T>) {
  const file = localSnapshotPath(name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(envelope), "utf8");
  return true;
}

export async function readFallbackSnapshot<T = any>(name: SnapshotName): Promise<T | null> {
  const key = snapshotKey(name);

  try {
    const result = await kvCommand(["GET", key]);

    if (typeof result === "string" && result.trim()) {
      const parsed = JSON.parse(result);
      const data = envelopeData<T>(parsed);

      if (data != null) return data;
    }

    if (result && typeof result === "object") {
      const data = envelopeData<T>(result);

      if (data != null) return data;
    }
  } catch (error: any) {
    if (error?.message !== "KV_NOT_CONFIGURED") {
      console.warn(`[fallback-snapshot] KV read failed for ${name}:`, error);
    }
  }

  return readLocalSnapshot<T>(name);
}

export async function writeFallbackSnapshot<T = any>(
  name: SnapshotName,
  data: T,
): Promise<SnapshotWriteResult> {
  const cleanName = cleanSnapshotName(name) || "snapshot";
  const key = snapshotKey(cleanName);
  const cleanData = sanitizeJson(data) as T;

  if (!isUsableSnapshotData(cleanName, cleanData)) {
    return {
      ok: false,
      key,
      skipped: true,
      reason: "not_usable_snapshot_data",
      stores: {
        kv: false,
        local: false,
      },
    };
  }

  const updatedAtMs = Date.now();
  const envelope: SnapshotEnvelope<T> = {
    version: SNAPSHOT_VERSION,
    name: cleanName,
    updatedAt: new Date(updatedAtMs).toISOString(),
    updatedAtMs,
    data: cleanData,
  };

  let kvSaved = false;
  let localSaved = false;
  let lastError: any = null;

  try {
    await kvCommand(["SET", key, JSON.stringify(envelope)]);
    kvSaved = true;
  } catch (error: any) {
    lastError = error;

    if (error?.message !== "KV_NOT_CONFIGURED") {
      console.warn(`[fallback-snapshot] KV write failed for ${cleanName}:`, error);
    }
  }

  try {
    localSaved = await writeLocalSnapshot(cleanName, envelope);
  } catch (error) {
    lastError = error;
    console.warn(`[fallback-snapshot] local write failed for ${cleanName}:`, error);
  }

  if (!kvSaved && !localSaved && lastError) {
    throw lastError;
  }

  return {
    ok: kvSaved || localSaved,
    key,
    updatedAt: envelope.updatedAt,
    stores: {
      kv: kvSaved,
      local: localSaved,
    },
  };
}
