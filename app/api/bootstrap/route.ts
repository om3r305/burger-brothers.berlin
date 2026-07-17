import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma, getTenantId } from "@/lib/db";
import {
  enforceRateLimit,
  hasSessionRole,
  verifyRequestSecret,
  unauthorizedResponse,
  securityJson,
} from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const KEY_DRINK_GROUPS = "drink_groups_v1";
const KEY_EXTRA_GROUPS = "extra_groups_v1";

const headers = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

type TxClient = any;

function json(data: Record<string, any>, status = 200) {
  return NextResponse.json(data, {
    status,
    headers,
  });
}

function cleanText(value: any, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function toDecimal(value: any) {
  const number =
    typeof value === "number"
      ? value
      : Number(String(value ?? "0").replace(",", "."));

  return new Prisma.Decimal(Number.isFinite(number) ? number : 0);
}

function toDateOrNull(value: any) {
  if (!value) return null;

  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? date : null;
}

function safeJson(value: any): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function extractSettings(body: any) {
  if (body?.settings && typeof body.settings === "object" && !Array.isArray(body.settings)) {
    return body.settings;
  }

  const fallback = { ...(body || {}) };
  delete fallback.catalog;

  return fallback;
}

async function upsertSetting(tx: TxClient, tenantId: string, key: string, value: any) {
  await tx.setting.upsert({
    where: {
      tenantId_key: {
        tenantId,
        key,
      },
    },
    update: {
      value: safeJson(value),
    },
    create: {
      tenantId,
      key,
      value: safeJson(value),
    },
  });
}

export async function POST(req: Request) {
  const rateError = enforceRateLimit(req, "bootstrap", 3, 15 * 60_000);
  if (rateError) return rateError;

  const tokenConfigured = Boolean(String(process.env.BOOTSTRAP_MIGRATION_TOKEN || "").trim());
  const tokenOk = verifyRequestSecret(
    req,
    process.env.BOOTSTRAP_MIGRATION_TOKEN,
    "x-bootstrap-token",
  );
  const adminOk = await hasSessionRole(req, "admin");
  const production = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);

  if (production && !tokenConfigured) {
    return securityJson(
      { ok: false, error: "bootstrap_disabled", message: "BOOTSTRAP_MIGRATION_TOKEN is not configured." },
      503,
    );
  }

  if (!tokenOk && !adminOk) return unauthorizedResponse();

  try {
    const body = await req.json().catch(() => ({}));

    const settings = extractSettings(body);
    const catalog = body?.catalog && typeof body.catalog === "object" ? body.catalog : {};

    const products = Array.isArray(catalog.products) ? catalog.products : [];
    const campaigns = Array.isArray(catalog.campaigns) ? catalog.campaigns : [];
    const drinkGroups = Array.isArray(catalog.drinkGroups) ? catalog.drinkGroups : [];
    const extraGroups = Array.isArray(catalog.extraGroups) ? catalog.extraGroups : [];

    const tenantId = await getTenantId();

    const seenSkus = new Set<string>();
    const seenCampaigns = new Set<string>();

    await prisma.$transaction(async (tx: any) => {
      for (const item of products) {
        const sku = cleanText(item?.sku ?? item?.id ?? item?.name);
        if (!sku) continue;

        seenSkus.add(sku);

        await tx.product.upsert({
          where: {
            tenantId_sku: {
              tenantId,
              sku,
            },
          },
          update: {
            name: cleanText(item?.name, sku),
            description: item?.description ? String(item.description) : null,
            imageUrl: item?.imageUrl ? String(item.imageUrl) : null,
            category: cleanText(item?.category, "burger"),
            price: toDecimal(item?.price),
            active: typeof item?.active === "boolean" ? item.active : true,
            activeFrom: toDateOrNull(item?.activeFrom),
            activeTo: toDateOrNull(item?.activeTo),
            extrasJson: item?.extras == null ? Prisma.JsonNull : safeJson(item.extras),
            allergens: item?.allergens == null ? Prisma.JsonNull : safeJson(item.allergens),
            order: item?.order == null ? null : Number(item.order) || 0,
            dailyLimit: item?.dailyLimit == null ? null : Number(item.dailyLimit) || 0,
          },
          create: {
            tenantId,
            sku,
            name: cleanText(item?.name, sku),
            description: item?.description ? String(item.description) : null,
            imageUrl: item?.imageUrl ? String(item.imageUrl) : null,
            category: cleanText(item?.category, "burger"),
            price: toDecimal(item?.price),
            active: typeof item?.active === "boolean" ? item.active : true,
            activeFrom: toDateOrNull(item?.activeFrom),
            activeTo: toDateOrNull(item?.activeTo),
            extrasJson: item?.extras == null ? Prisma.JsonNull : safeJson(item.extras),
            allergens: item?.allergens == null ? Prisma.JsonNull : safeJson(item.allergens),
            order: item?.order == null ? null : Number(item.order) || 0,
            dailyLimit: item?.dailyLimit == null ? null : Number(item.dailyLimit) || 0,
          },
        });
      }

      for (const campaign of campaigns) {
        const code = cleanText(campaign?.code ?? campaign?.id);
        if (!code) continue;

        seenCampaigns.add(code);

        const existing = await tx.campaign.findFirst({
          where: {
            tenantId,
            code,
          },
          select: {
            id: true,
          },
        });

        const data = {
          code,
          title: cleanText(campaign?.title ?? campaign?.badgeText, "Kampagne"),
          badgeText: campaign?.badgeText ? String(campaign.badgeText) : null,
          payload: safeJson(campaign?.payload ?? campaign),
          startsAt: toDateOrNull(campaign?.startsAt),
          endsAt: toDateOrNull(campaign?.endsAt),
        };

        if (existing?.id) {
          await tx.campaign.update({
            where: {
              id: existing.id,
            },
            data,
          });
        } else {
          await tx.campaign.create({
            data: {
              tenantId,
              ...data,
            },
          });
        }
      }

      for (const [key, value] of Object.entries(settings || {})) {
        if (!key || key === "catalog") continue;
        await upsertSetting(tx, tenantId, key, value);
      }

      await upsertSetting(tx, tenantId, KEY_DRINK_GROUPS, drinkGroups);
      await upsertSetting(tx, tenantId, KEY_EXTRA_GROUPS, extraGroups);
    });

    return json({
      ok: true,
      message: "Bootstrap abgeschlossen",
      counts: {
        products: seenSkus.size,
        campaigns: seenCampaigns.size,
        settings: Object.keys(settings || {}).filter((key) => key !== "catalog").length,
        drinkGroups: drinkGroups.length,
        extraGroups: extraGroups.length,
      },
    });
  } catch (error: any) {
    return json(
      {
        ok: false,
        error: error?.message || "BOOTSTRAP_FAILED",
      },
      500,
    );
  }
}