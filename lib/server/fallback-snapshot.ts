// lib/server/fallback-snapshot.ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type FallbackSnapshotKey = "products" | "catalog" | "settings" | string;

type StoredSnapshot<T = any> = {
  version: 1;
  key: string;
  updatedAt: string;
  data: T;
};

type WriteResult = {
  ok: boolean;
  storage: boolean;
  publicJson: boolean;
  updatedAt: string;
};

const PREFIX = process.env.FALLBACK_SNAPSHOT_PREFIX || "bb:fallback:v1";

function snapshotStorageKey(key: FallbackSnapshotKey) {
  return `${PREFIX}:${String(key).trim()}`;
}

function storageEnv() {
  const url =
    process.env.FALLBACK_KV_REST_API_URL ||
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    "";

  const token =
    process.env.FALLBACK_KV_REST_API_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    "";

  if (!url || !token) return null;

  return {
    url: url.replace(/\/+$/, ""),
    token,
  };
}

function fallbackFilePath(key: FallbackSnapshotKey) {
  const safe = String(key)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return path.join(process.cwd(), "public", "fallback", `${safe || "snapshot"}.json`);
}

function safeJsonParse(value: any) {
  if (value == null) return null;

  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function unwrapSnapshot<T = any>(value: any): T | null {
  const parsed = safeJsonParse(value);

  if (!parsed || typeof parsed !== "object") return null;

  if (
    Object.prototype.hasOwnProperty.call(parsed, "data") &&
    Object.prototype.hasOwnProperty.call(parsed, "updatedAt")
  ) {
    return (parsed as StoredSnapshot<T>).data ?? null;
  }

  return parsed as T;
}

async function redisCommand(args: any[]) {
  const env = storageEnv();
  if (!env) return null;

  const response = await fetch(`${env.url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([args]),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`fallback_storage_http_${response.status}${text ? `_${text}` : ""}`);
  }

  const json = await response.json().catch(() => null);
  const first = Array.isArray(json) ? json[0] : json;

  if (first?.error) {
    throw new Error(String(first.error));
  }

  return first?.result ?? null;
}

async function readFromPublicJson<T = any>(key: FallbackSnapshotKey): Promise<T | null> {
  try {
    const raw = await readFile(fallbackFilePath(key), "utf-8");
    return unwrapSnapshot<T>(raw);
  } catch {
    return null;
  }
}

async function writePublicJson<T = any>(
  key: FallbackSnapshotKey,
  snapshot: StoredSnapshot<T>,
): Promise<boolean> {
  /*
    Canlı Vercel ortamında deploy edilmiş public klasörü yazılabilir değildir.
    Bu yazma işlemi sadece local/dev veya bilerek açılan ortamlar içindir.
  */
  if (process.env.FALLBACK_WRITE_PUBLIC_JSON !== "1") {
    return false;
  }

  try {
    const filepath = fallbackFilePath(key);
    await mkdir(path.dirname(filepath), { recursive: true });
    await writeFile(filepath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf-8");
    return true;
  } catch (error) {
    console.warn(`[fallback] public json write failed for ${key}`, error);
    return false;
  }
}

export async function readFallbackSnapshot<T = any>(
  key: FallbackSnapshotKey,
): Promise<T | null> {
  try {
    const stored = await redisCommand(["GET", snapshotStorageKey(key)]);
    const fromStorage = unwrapSnapshot<T>(stored);

    if (fromStorage) return fromStorage;
  } catch (error) {
    console.warn(`[fallback] storage read failed for ${key}`, error);
  }

  return readFromPublicJson<T>(key);
}

export async function writeFallbackSnapshot<T = any>(
  key: FallbackSnapshotKey,
  data: T,
): Promise<WriteResult> {
  const snapshot: StoredSnapshot<T> = {
    version: 1,
    key: String(key),
    updatedAt: new Date().toISOString(),
    data,
  };

  let storage = false;

  try {
    if (storageEnv()) {
      await redisCommand(["SET", snapshotStorageKey(key), JSON.stringify(snapshot)]);
      storage = true;
    }
  } catch (error) {
    console.warn(`[fallback] storage write failed for ${key}`, error);
  }

  const publicJson = await writePublicJson(key, snapshot);

  return {
    ok: storage || publicJson,
    storage,
    publicJson,
    updatedAt: snapshot.updatedAt,
  };
}
