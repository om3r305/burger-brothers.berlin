// app/api/groups/route.ts
import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const KEY_DRINK_GROUPS = "bb_drink_groups_v1";
const KEY_EXTRA_GROUPS = "bb_extra_groups_v1";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

type GroupsPayload = {
  drinkGroups?: any[];
  extraGroups?: any[];
  drinks?: any[];
  extras?: any[];
  groups?: {
    drinkGroups?: any[];
    extraGroups?: any[];
    drinks?: any[];
    extras?: any[];
  };
  data?: {
    drinkGroups?: any[];
    extraGroups?: any[];
    drinks?: any[];
    extras?: any[];
    groups?: {
      drinkGroups?: any[];
      extraGroups?: any[];
      drinks?: any[];
      extras?: any[];
    };
  };
};

function jsonOk(data: Record<string, any>, status = 200) {
  return NextResponse.json(
    {
      ok: true,
      source: "db",
      ...data,
    },
    {
      status,
      headers: NO_STORE_HEADERS,
    },
  );
}

function jsonError(error: any, fallback: string, status = 500) {
  return NextResponse.json(
    {
      ok: false,
      source: "db",
      error: error?.message || fallback,
    },
    {
      status,
      headers: NO_STORE_HEADERS,
    },
  );
}

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

function cleanText(value: any, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function cleanId(value: any, fallback = "") {
  const text = String(value ?? "")
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 96);

  return text || fallback;
}

function toNumber(value: any, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value == null || value === "") return fallback;

  const text = String(value).trim().replace(/[€\s]/g, "").replace(",", ".");
  const match = text.match(/-?\d+(\.\d+)?/);
  const number = match ? Number(match[0]) : Number(text);

  return Number.isFinite(number) ? number : fallback;
}

function toBool(value: any, fallback = true) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null || value === "") return fallback;

  const text = String(value).toLowerCase().trim();

  if (["1", "true", "yes", "ja", "aktiv", "on"].includes(text)) return true;
  if (["0", "false", "no", "nein", "inaktiv", "off"].includes(text)) return false;

  return fallback;
}

function sanitizeJson(value: any): any {
  if (value === undefined) return null;
  if (value === null) return null;

  if (value instanceof Date) {
    return Number.isFinite(value.valueOf()) ? value.toISOString() : null;
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

function asArray(value: any): any[] {
  return Array.isArray(value) ? value : [];
}

function normalizeVariantArray(value: any): any[] {
  const variants = Array.isArray(value)
    ? value
    : Array.isArray(value?.items)
      ? value.items
      : Array.isArray(value?.options)
        ? value.options
        : [];

  return variants
    .filter(Boolean)
    .map((variant: any, index: number) => {
      const name = cleanText(
        variant?.name ?? variant?.title ?? variant?.label,
        `Variante ${index + 1}`,
      );

      const id = cleanId(
        variant?.id ?? variant?.sku ?? variant?.code ?? name,
        `variant-${index + 1}`,
      );

      const stockRaw = variant?.stock ?? variant?.bestand ?? variant?.limit;

      const stock =
        stockRaw === "" || stockRaw === null || stockRaw === undefined
          ? null
          : Math.max(0, Math.floor(toNumber(stockRaw, 0)));

      return sanitizeJson({
        ...variant,
        id,
        sku: cleanText(variant?.sku ?? variant?.code, ""),
        name,
        label: cleanText(variant?.label ?? name, name),
        price: toNumber(variant?.price ?? variant?.preis, 0),
        active: toBool(variant?.active ?? variant?.enabled, true),
        stock,
        image:
          variant?.image || variant?.imageUrl || variant?.cover
            ? String(variant.image ?? variant.imageUrl ?? variant.cover)
            : undefined,
      });
    });
}

function normalizeGroupArray(value: any): any[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(Boolean)
    .map((group: any, index: number) => {
      const name = cleanText(group?.name ?? group?.title, `Gruppe ${index + 1}`);

      const sku = cleanId(
        group?.sku ?? group?.code ?? group?.slug ?? group?.id ?? name,
        `group-${index + 1}`,
      );

      const id = cleanId(group?.id ?? sku, sku || `group-${index + 1}`);

      const variantsSource = Array.isArray(group?.variants)
        ? group.variants
        : Array.isArray(group?.items)
          ? group.items
          : Array.isArray(group?.options)
            ? group.options
            : [];

      return sanitizeJson({
        ...group,
        id,
        sku,
        name,
        title: group?.title ?? name,
        description:
          group?.description || group?.desc ? String(group.description ?? group.desc) : undefined,
        image:
          group?.image || group?.imageUrl || group?.cover
            ? String(group.image ?? group.imageUrl ?? group.cover)
            : undefined,
        variants: normalizeVariantArray(variantsSource),
      });
    });
}

function readDrinkGroupsFromBody(body: GroupsPayload): any[] | undefined {
  const value =
    body?.drinkGroups ??
    body?.drinks ??
    body?.groups?.drinkGroups ??
    body?.groups?.drinks ??
    body?.data?.drinkGroups ??
    body?.data?.drinks ??
    body?.data?.groups?.drinkGroups ??
    body?.data?.groups?.drinks;

  return Array.isArray(value) ? normalizeGroupArray(value) : undefined;
}

function readExtraGroupsFromBody(body: GroupsPayload): any[] | undefined {
  const value =
    body?.extraGroups ??
    body?.extras ??
    body?.groups?.extraGroups ??
    body?.groups?.extras ??
    body?.data?.extraGroups ??
    body?.data?.extras ??
    body?.data?.groups?.extraGroups ??
    body?.data?.groups?.extras;

  return Array.isArray(value) ? normalizeGroupArray(value) : undefined;
}

async function readSettingArray(tenantId: string, key: string): Promise<any[]> {
  const row = await prisma.setting.findFirst({
    where: {
      tenantId,
      key,
    },
    select: {
      value: true,
    },
  });

  return normalizeGroupArray(asArray(row?.value));
}

async function readRequestBody(req: Request): Promise<GroupsPayload> {
  try {
    return (await req.json()) as GroupsPayload;
  } catch {
    return {};
  }
}

/*
  Prisma Json field için güvenli değer.
  Bu route içinde gruplar daima array olarak saklanır.
  Prisma.JsonNull kullanmıyoruz; bazı Prisma sürümlerinde InputJsonValue ile tip çakışması çıkarıyor.
*/
function toSettingJsonArray(value: any[]): any {
  return normalizeGroupArray(value);
}

async function saveSettingArrayWithTx(tx: any, tenantId: string, key: string, value: any[]) {
  const normalized = toSettingJsonArray(value);

  const existing = await tx.setting.findFirst({
    where: {
      tenantId,
      key,
    },
    select: {
      id: true,
    },
  });

  if (existing?.id) {
    await tx.setting.update({
      where: {
        id: existing.id,
      },
      data: {
        value: normalized,
      },
    });

    await tx.setting.deleteMany({
      where: {
        tenantId,
        key,
        id: {
          not: existing.id,
        },
      },
    });

    return;
  }

  await tx.setting.create({
    data: {
      tenantId,
      key,
      value: normalized,
    },
  });
}

async function readAllGroups(tenantId: string) {
  const [drinkGroups, extraGroups] = await Promise.all([
    readSettingArray(tenantId, KEY_DRINK_GROUPS),
    readSettingArray(tenantId, KEY_EXTRA_GROUPS),
  ]);

  return {
    drinkGroups,
    extraGroups,
  };
}

function groupsResponse(drinkGroups: any[], extraGroups: any[]) {
  return {
    drinkGroups,
    extraGroups,
    drinks: drinkGroups,
    extras: extraGroups,
    groups: {
      drinkGroups,
      extraGroups,
      drinks: drinkGroups,
      extras: extraGroups,
    },
    data: {
      drinkGroups,
      extraGroups,
      drinks: drinkGroups,
      extras: extraGroups,
      groups: {
        drinkGroups,
        extraGroups,
        drinks: drinkGroups,
        extras: extraGroups,
      },
    },
    counts: {
      drinkGroups: drinkGroups.length,
      extraGroups: extraGroups.length,
      drinks: drinkGroups.length,
      extras: extraGroups.length,
    },
  };
}

export async function GET() {
  try {
    const tenantId = await getTenantId();
    const { drinkGroups, extraGroups } = await readAllGroups(tenantId);

    return jsonOk(groupsResponse(drinkGroups, extraGroups));
  } catch (error: any) {
    return jsonError(error, "GROUPS_GET_FAILED");
  }
}

export async function PUT(req: Request) {
  try {
    const tenantId = await getTenantId();
    const body = await readRequestBody(req);

    const drinkGroups = readDrinkGroupsFromBody(body);
    const extraGroups = readExtraGroupsFromBody(body);

    /*
      DB-first güvenlik:
      - undefined = bu taraf gönderilmedi, mevcut DB değerine dokunma
      - [] = bilinçli boş liste, bu tarafı temizle
    */
    if (drinkGroups === undefined && extraGroups === undefined) {
      return jsonError(new Error("EMPTY_PAYLOAD"), "EMPTY_PAYLOAD", 400);
    }

    await prisma.$transaction(async (tx) => {
      if (drinkGroups !== undefined) {
        await saveSettingArrayWithTx(tx, tenantId, KEY_DRINK_GROUPS, drinkGroups);
      }

      if (extraGroups !== undefined) {
        await saveSettingArrayWithTx(tx, tenantId, KEY_EXTRA_GROUPS, extraGroups);
      }
    });

    const saved = await readAllGroups(tenantId);

    return jsonOk(groupsResponse(saved.drinkGroups, saved.extraGroups));
  } catch (error: any) {
    return jsonError(error, "GROUPS_PUT_FAILED");
  }
}

export async function POST(req: Request) {
  return PUT(req);
}