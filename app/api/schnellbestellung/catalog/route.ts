import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";
import {
  getSchnellCampaignPrice,
  getSchnellSettings,
  isComplimentaryTableSauce,
  normalizeSchnellCategory,
  SCHNELL_CATEGORY_ORDER,
  SCHNELL_COOKIE,
  schnellCategoryLabel,
  verifySessionToken,
} from "@/lib/server/schnellbestellung";
import { readRequestCookie } from "@/lib/server/request-security";

function normalizeExtras(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((entry: any) => ({
          id: String(entry?.id || entry?.sku || entry?.name || ""),
          name: String(entry?.name || entry?.label || "Extra"),
          label: String(entry?.label || entry?.name || "Extra"),
          price: Number(entry?.price) || 0,
        }))
        .filter((entry) => entry.id || entry.name)
    : [];
}

function normalizeAllergens(value: unknown) {
  let parsed = value;

  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return { allergens: [] as string[], allergenHinweise: "" };

    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text.split(/[;,]/g);
    }
  }

  const normalizeCodes = (items: unknown[]) =>
    Array.from(
      new Set(
        items
          .map(String)
          .map((item) => item.trim().toUpperCase())
          .filter(Boolean),
      ),
    );

  if (Array.isArray(parsed)) {
    return {
      allergens: normalizeCodes(parsed),
      allergenHinweise: "",
    };
  }

  if (parsed && typeof parsed === "object") {
    const raw = parsed as Record<string, unknown>;
    const list = Array.isArray(raw.items)
      ? raw.items
      : Array.isArray(raw.allergens)
        ? raw.allergens
        : Array.isArray(raw.codes)
          ? raw.codes
          : [];

    return {
      allergens: normalizeCodes(list),
      allergenHinweise: String(
        raw.allergenHinweise || raw.hinweise || raw.note || raw.notes || "",
      ).trim(),
    };
  }

  return { allergens: [] as string[], allergenHinweise: "" };
}

export async function GET(req: Request) {
  const settings = await getSchnellSettings();
  const session = verifySessionToken(
    readRequestCookie(req, SCHNELL_COOKIE),
    settings,
  );

  if (!session) {
    return NextResponse.json(
      { ok: false, error: "session_required" },
      { status: 401 },
    );
  }

  if (!settings.enabled || settings.paused) {
    return NextResponse.json(
      { ok: false, error: "unavailable" },
      { status: 503 },
    );
  }

  try {
    const tenantId = await getTenantId();
    const rows = await prisma.product.findMany({
      where: { tenantId, active: true },
      orderBy: [{ order: "asc" }, { name: "asc" }],
    });

    const products = rows
      .filter((product) => {
        const now = Date.now();
        if (product.activeFrom && product.activeFrom.getTime() > now) return false;
        if (product.activeTo && product.activeTo.getTime() < now) return false;
        if (settings.hiddenProductIds.includes(product.id)) return false;
        if (isComplimentaryTableSauce(product.category, product.name)) return false;

        const normalizedCategory = normalizeSchnellCategory(product.category);
        if (
          settings.visibleCategories.length > 0 &&
          !settings.visibleCategories.includes(product.category) &&
          !settings.visibleCategories.includes(normalizedCategory)
        ) {
          return false;
        }

        return true;
      })
      .map((product) => {
        const category = normalizeSchnellCategory(product.category);
        const allergenData = normalizeAllergens(product.allergens);
        const campaignPrice = getSchnellCampaignPrice(
          {
            id: product.id,
            category: product.category,
            price: Number(product.price),
          },
          settings,
        );

        return {
          id: product.id,
          sku: product.sku,
          name: product.name,
          description: product.description || "",
          imageUrl: product.imageUrl || "",
          category,
          categoryLabel: schnellCategoryLabel(category),
          categoryOrder: SCHNELL_CATEGORY_ORDER.indexOf(category),
          price: campaignPrice.price,
          originalPrice: campaignPrice.originalPrice,
          campaignBadge: campaignPrice.badgeText,
          campaignName: campaignPrice.campaign?.name,
          extras: normalizeExtras(product.extrasJson),
          allergens: allergenData.allergens,
          allergenHinweise: allergenData.allergenHinweise,
          active: true,
        };
      })
      .sort((left, right) => {
        if (left.categoryOrder !== right.categoryOrder) {
          return left.categoryOrder - right.categoryOrder;
        }
        return left.name.localeCompare(right.name, "de");
      });

    const categories = SCHNELL_CATEGORY_ORDER.filter((category) =>
      products.some((product) => product.category === category),
    ).map((category) => ({
      key: category,
      label: schnellCategoryLabel(category),
    }));

    return NextResponse.json(
      {
        ok: true,
        source: "db",
        products,
        categories,
        settings: {
          cashEnabled: settings.cashEnabled,
          onlineEnabled: settings.onlineEnabled,
          splitEnabled: settings.splitEnabled,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[schnellbestellung/catalog] failed", error);
    return NextResponse.json(
      {
        ok: false,
        source: "default_fallback",
        error: "catalog_unavailable",
        products: [],
        categories: [],
      },
      { status: 503 },
    );
  }
}
