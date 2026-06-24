// app/api/brian/export/db.ts
import { Prisma } from "@prisma/client";
import { prisma, getTenantId } from "@/lib/db";

const brianDb = prisma as any;

type Pair = {
  a: string;
  b: string;
  support: number;
  lift: number;
  confidence_lb: number;
  negative?: boolean;
};

type Cluster = {
  id: string;
  color?: string | null;
  streets: string[];
};

type BrianModelPayload = {
  meta: any;
  pairs: Pair[];
  clusters: Cluster[];
};

const MODEL_KEY = "current";
const LEGACY_SETTING_KEY = "brian_model";

function isPlainObject(value: any): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isSafeKey(key: string) {
  if (!key) return false;
  if (key === "__proto__") return false;
  if (key === "prototype") return false;
  if (key === "constructor") return false;
  return true;
}

function toNumber(value: any, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cleanText(value: any, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function sanitizeJson(value: any): any {
  if (value === undefined) return null;
  if (value === null) return null;

  if (value instanceof Date) {
    return Number.isFinite(value.valueOf()) ? value.toISOString() : null;
  }

  if (value instanceof Prisma.Decimal) {
    return value.toNumber();
  }

  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return null;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJson(item));
  }

  if (isPlainObject(value)) {
    const out: Record<string, any> = {};

    for (const [key, item] of Object.entries(value)) {
      if (!isSafeKey(key)) continue;
      if (item === undefined) continue;
      out[key] = sanitizeJson(item);
    }

    return out;
  }

  return value;
}

function jsonForDb(value: any): Prisma.InputJsonValue {
  const cleaned = sanitizeJson(value);
  return (cleaned ?? {}) as Prisma.InputJsonValue;
}

function normalizeBrianPayload(payload: BrianModelPayload) {
  const nowIso = new Date().toISOString();

  const pairs = Array.isArray(payload?.pairs)
    ? payload.pairs
        .filter(Boolean)
        .map((pair) => ({
          a: cleanText(pair?.a),
          b: cleanText(pair?.b),
          support: toNumber(pair?.support, 0),
          lift: toNumber(pair?.lift, 0),
          confidence_lb: toNumber(pair?.confidence_lb, 0),
          negative: Boolean(pair?.negative),
        }))
        .filter((pair) => pair.a && pair.b)
    : [];

  const clusters = Array.isArray(payload?.clusters)
    ? payload.clusters
        .filter(Boolean)
        .map((cluster) => ({
          id: cleanText(cluster?.id),
          color: cluster?.color ? String(cluster.color) : null,
          streets: Array.isArray(cluster?.streets)
            ? cluster.streets.map((street) => cleanText(street)).filter(Boolean)
            : [],
        }))
        .filter((cluster) => cluster.id)
    : [];

  const meta = isPlainObject(payload?.meta) ? sanitizeJson(payload.meta) : {};

  return {
    meta: {
      ...meta,
      updatedAt: meta?.updatedAt || nowIso,
      windowDays: toNumber(meta?.windowDays, 60),
    },
    pairs,
    clusters,
  };
}

function modelStats(value: ReturnType<typeof normalizeBrianPayload>) {
  return {
    pairs: value.pairs.length,
    clusters: value.clusters.length,
    logCount: toNumber(value.meta?.logCount, 0),
    storage: cleanText(value.meta?.storage, "unknown"),
    updatedAt: cleanText(value.meta?.updatedAt, new Date().toISOString()),
    windowDays: toNumber(value.meta?.windowDays, 60),
  };
}

/**
 * Legacy backup.
 *
 * Eski sistem veya başka bir dosya hâlâ Setting key=brian_model okuyorsa
 * akış bozulmasın diye buraya da yazar.
 */
async function writeLegacySettingBackup(tenantId: string, value: ReturnType<typeof normalizeBrianPayload>) {
  try {
    await prisma.setting.upsert({
      where: {
        tenantId_key: {
          tenantId,
          key: LEGACY_SETTING_KEY,
        },
      },
      update: {
        value: jsonForDb(value),
      },
      create: {
        tenantId,
        key: LEGACY_SETTING_KEY,
        value: jsonForDb(value),
      },
    });

    return true;
  } catch (error) {
    console.error("writeBrianModelToDB legacy Setting backup failed", error);
    return false;
  }
}

/**
 * Brian model export — DB-first.
 *
 * Güncel sistem:
 * - Ana kayıt: BrianRouteModel tablosu, key=current
 * - Uyumluluk backup: Setting tablosu, key=brian_model
 *
 * Fonksiyon adı korunuyor ki mevcut import/call yapan dosyalar bozulmasın.
 */
export async function writeBrianModelToDB(payload: BrianModelPayload): Promise<void> {
  const value = normalizeBrianPayload(payload);

  try {
    const tenantId = await getTenantId();
    const stats = modelStats(value);
    const generatedAt = new Date(value.meta?.updatedAt || Date.now());

    await brianDb.brianRouteModel.upsert({
      where: {
        tenantId_key: {
          tenantId,
          key: MODEL_KEY,
        },
      },
      update: {
        model: jsonForDb(value),
        stats: jsonForDb(stats),
        generatedAt,
      },
      create: {
        tenantId,
        key: MODEL_KEY,
        version: 1,
        model: jsonForDb(value),
        stats: jsonForDb(stats),
        generatedAt,
      },
      select: {
        id: true,
      },
    });

    await writeLegacySettingBackup(tenantId, value);
  } catch (error) {
    console.error("writeBrianModelToDB BrianRouteModel failed", error);

    try {
      const tenantId = await getTenantId();
      await writeLegacySettingBackup(tenantId, value);
    } catch (fallbackError) {
      console.error("writeBrianModelToDB fallback failed", fallbackError);
    }
  }
}

/**
 * Opsiyonel okuyucu.
 *
 * Başka dosyalar ileride DB modelini direkt okumak isterse hazır.
 * Önce BrianRouteModel okur, yoksa legacy Setting backup'a bakar.
 */
export async function readBrianModelFromDB(): Promise<BrianModelPayload | null> {
  try {
    const tenantId = await getTenantId();

    const routeModel = await brianDb.brianRouteModel.findUnique({
      where: {
        tenantId_key: {
          tenantId,
          key: MODEL_KEY,
        },
      },
      select: {
        model: true,
      },
    });

    if (routeModel?.model) {
      return routeModel.model as BrianModelPayload;
    }

    const setting = await prisma.setting.findUnique({
      where: {
        tenantId_key: {
          tenantId,
          key: LEGACY_SETTING_KEY,
        },
      },
      select: {
        value: true,
      },
    });

    if (setting?.value) {
      return setting.value as BrianModelPayload;
    }

    return null;
  } catch (error) {
    console.error("readBrianModelFromDB failed", error);
    return null;
  }
}