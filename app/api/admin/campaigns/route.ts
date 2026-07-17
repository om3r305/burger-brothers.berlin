// app/api/admin/campaigns/route.ts
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma, getTenantId } from "@/lib/db";
import { requireMutationRole, requireSessionRole } from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;


const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};


function unauthorized() {
  return NextResponse.json(
    {
      ok: false,
      source: "db",
      error: "Nicht angemeldet.",
    },
    {
      status: 401,
      headers: NO_STORE_HEADERS,
    },
  );
}

function jsonResponse(payload: Record<string, any>, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

function errorResponse(error: any, fallback: string, status = 500) {
  return jsonResponse(
    {
      ok: false,
      source: "db",
      error: error?.message || fallback,
    },
    status,
  );
}

function cleanText(value: any, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function kebab(value: any) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

function toDate(value: any) {
  if (!value && value !== 0) return null;

  if (value instanceof Date) {
    return Number.isFinite(value.valueOf()) ? value : null;
  }

  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isFinite(date.valueOf()) ? date : null;
  }

  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;

    const asNumber = Number(text);
    if (Number.isFinite(asNumber) && asNumber > 0) {
      const byNumber = new Date(asNumber);
      if (Number.isFinite(byNumber.valueOf())) return byNumber;
    }

    const parsed = new Date(text);
    return Number.isFinite(parsed.valueOf()) ? parsed : null;
  }

  return null;
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

function normalizeCampaignInput(value: any) {
  const payload = value?.payload ?? value;
  const id = value?.id ? String(value.id).trim() : null;

  const title =
    value?.title ??
    payload?.name ??
    payload?.title ??
    value?.badgeText ??
    "Kampagne";

  const code = cleanText(
    value?.code ?? payload?.code ?? id ?? kebab(title),
    "kampagne",
  );

  return {
    id,
    code,
    data: {
      code,
      title: String(title),
      badgeText: value?.badgeText
        ? String(value.badgeText)
        : payload?.badge
          ? String(payload.badge)
          : null,
      startsAt: toDate(value?.startsAt ?? payload?.startAt ?? payload?.validFrom),
      endsAt: toDate(value?.endsAt ?? payload?.endAt ?? payload?.validUntil),
      payload: jsonForDb(payload),
    },
  };
}

function readItems(body: any) {
  return Array.isArray(body?.items)
    ? body.items
    : Array.isArray(body?.campaigns)
      ? body.campaigns
      : Array.isArray(body?.data)
        ? body.data
        : body?.item
          ? [body.item]
          : [];
}

async function listCampaigns(tenantId: string) {
  return prisma.campaign.findMany({
    where: {
      tenantId,
    },
    orderBy: [
      {
        createdAt: "desc",
      },
    ],
  });
}

async function readBody(req: Request) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export async function GET(req: Request) {
  const authError = req.method === "GET"
    ? await requireSessionRole(req, "admin")
    : await requireMutationRole(req, ["admin"]);
  if (authError) return authError;

  try {
    const tenantId = await getTenantId();
    const items = await listCampaigns(tenantId);

    return jsonResponse({
      ok: true,
      source: "db",
      items,
      campaigns: items,
      count: items.length,
    });
  } catch (error: any) {
    return errorResponse(error, "CAMPAIGNS_GET_FAILED");
  }
}

/**
 * POST supports:
 * - { items: [...] } save many
 * - { replace: true, items: [...] } replace tenant campaign list
 */
export async function POST(req: Request) {
  const authError = req.method === "GET"
    ? await requireSessionRole(req, "admin")
    : await requireMutationRole(req, ["admin"]);
  if (authError) return authError;

  try {
    const tenantId = await getTenantId();
    const body = await readBody(req);

    const replace = body?.replace === true;
    const items = readItems(body);
    const savedIds: string[] = [];

    await prisma.$transaction(async (tx: any) => {
      for (const raw of items) {
        const normalized = normalizeCampaignInput(raw);

        const existing = await tx.campaign.findFirst({
          where: {
            tenantId,
            OR: [
              ...(normalized.id ? [{ id: normalized.id }] : []),
              ...(normalized.code ? [{ code: normalized.code }] : []),
            ],
          },
          select: {
            id: true,
          },
        });

        if (existing?.id) {
          const updated = await tx.campaign.update({
            where: {
              id: existing.id,
            },
            data: normalized.data,
          });

          savedIds.push(updated.id);
          continue;
        }

        const created = await tx.campaign.create({
          data: {
            ...(normalized.id ? { id: normalized.id } : {}),
            tenantId,
            ...normalized.data,
          } as any,
        });

        savedIds.push(created.id);
      }

      /*
        DB-first güvenlik:
        replace=true boş/stale payload ile gelirse kampanyaları silmiyoruz.
      */
      if (replace && items.length > 0 && savedIds.length > 0) {
        await tx.campaign.deleteMany({
          where: {
            tenantId,
            id: {
              notIn: savedIds,
            },
          },
        });
      }
    });

    const campaigns = await listCampaigns(tenantId);

    return jsonResponse({
      ok: true,
      source: "db",
      saved: savedIds.length,
      ids: savedIds,
      items: campaigns,
      campaigns,
      count: campaigns.length,
    });
  } catch (error: any) {
    return errorResponse(error, "CAMPAIGNS_POST_FAILED");
  }
}

export async function PUT(req: Request) {
  return POST(req);
}

export async function DELETE(req: Request) {
  const authError = req.method === "GET"
    ? await requireSessionRole(req, "admin")
    : await requireMutationRole(req, ["admin"]);
  if (authError) return authError;

  try {
    const tenantId = await getTenantId();
    const { searchParams } = new URL(req.url);

    const id = searchParams.get("id");
    const code = searchParams.get("code");

    if (!id && !code) {
      return jsonResponse(
        {
          ok: false,
          source: "db",
          error: "id_or_code_required",
        },
        400,
      );
    }

    await prisma.campaign.deleteMany({
      where: {
        tenantId,
        ...(id ? { id } : {}),
        ...(code ? { code } : {}),
      },
    });

    const campaigns = await listCampaigns(tenantId);

    return jsonResponse({
      ok: true,
      source: "db",
      items: campaigns,
      campaigns,
      count: campaigns.length,
    });
  } catch (error: any) {
    return errorResponse(error, "CAMPAIGNS_DELETE_FAILED");
  }
}