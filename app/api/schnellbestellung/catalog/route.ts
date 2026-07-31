import { NextResponse } from "next/server";
import {
  buildSchnellLunchCatalogProducts,
  getSchnellCampaignPrice,
  getSchnellLunchAvailability,
  getSchnellSettings,
  isComplimentaryTableSauce,
  loadSchnellCatalogProducts,
  SCHNELL_CATEGORY_ORDER,
  SCHNELL_COOKIE,
  schnellCategoryLabel,
  schnellProductIsAllowed,
  verifySessionToken,
} from "@/lib/server/schnellbestellung";
import { readRequestCookie } from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type CatalogPayload = {
  ok: true;
  source: "db";
  products: Array<Record<string, unknown>>;
  categories: Array<{ key: string; label: string }>;
  settings: {
    cashEnabled: boolean;
    onlineEnabled: boolean;
    splitEnabled: boolean;
    takeawayEnabled: boolean;
    orderHistoryEnabled: boolean;
    historyMaxOrders: number;
    historyDays: number;
    lunchActive: boolean;
    lunchAvailableUntil?: string;
    lunchSchedule: {
      enabled: boolean;
      weekdays: number[];
      startTime: string;
      endTime: string;
      timezone: "Europe/Berlin";
    };
  };
  serverNow: string;
};

let memoryCache:
  | {
      key: string;
      expiresAt: number;
      payload: CatalogPayload;
    }
  | null = null;

const CATALOG_MEMORY_TTL_MS = 30_000;

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

function settingsCacheKey(
  settings: Awaited<ReturnType<typeof getSchnellSettings>>,
  lunchAvailability: ReturnType<typeof getSchnellLunchAvailability>,
) {
  return JSON.stringify({
    generation: settings.generation,
    visibleCategories: settings.visibleCategories,
    hiddenProductIds: settings.hiddenProductIds,
    campaigns: settings.campaigns,
    lunchMenu: settings.lunchMenu,
    lunchActive: lunchAvailability.active,
    payments: [
      settings.cashEnabled,
      settings.onlineEnabled,
      settings.splitEnabled,
      settings.takeawayEnabled,
      settings.orderHistoryEnabled,
      settings.historyMaxOrders,
      settings.historyDays,
    ],
  });
}

function cachedPayload(key: string) {
  if (!memoryCache) return null;

  if (memoryCache.expiresAt <= Date.now() || memoryCache.key !== key) {
    memoryCache = null;
    return null;
  }

  return memoryCache.payload;
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
      {
        status: 401,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }

  if (!settings.enabled || settings.paused) {
    return NextResponse.json(
      { ok: false, error: "unavailable" },
      {
        status: 503,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }

  try {
    const now = new Date();
    const lunchAvailability = getSchnellLunchAvailability(settings, now);
    const cacheKey = settingsCacheKey(settings, lunchAvailability);
    const cached = cachedPayload(cacheKey);

    if (cached) {
      return NextResponse.json(
        {
          ...cached,
          memoryCached: true,
        },
        {
          headers: {
            "Cache-Control": "private, max-age=30, stale-while-revalidate=120",
          },
        },
      );
    }

    const allRows = await loadSchnellCatalogProducts(settings, {
      applyVisibility: false,
    });
    const rows = allRows.filter((product) =>
      schnellProductIsAllowed(product, settings),
    );
    const lunchRows = buildSchnellLunchCatalogProducts(
      allRows,
      settings,
      now,
      { requireActive: false },
    );

    const products = [...rows, ...lunchRows]
      .map((product) => {
        const allergenData = normalizeAllergens(product.allergens);
        const campaignPrice =
          product.sourceKind === "lunch_menu"
            ? {
                price: Number(product.price),
                originalPrice: undefined,
                badgeText: undefined,
                campaign: null,
              }
            : getSchnellCampaignPrice(
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
          category: product.category,
          categoryLabel: schnellCategoryLabel(product.category),
          categoryOrder: SCHNELL_CATEGORY_ORDER.indexOf(product.category),
          price: campaignPrice.price,
          taxRate: Number(product.taxRate) === 19 ? 19 : 7,
          originalPrice: campaignPrice.originalPrice,
          campaignBadge: campaignPrice.badgeText,
          campaignName: campaignPrice.campaign?.name,
          campaignActive: Boolean(campaignPrice.campaign),
          extras: normalizeExtras(product.extrasJson),
          allergens: allergenData.allergens,
          allergenHinweise: allergenData.allergenHinweise,
          sourceKind: product.sourceKind,
          depositAmount: product.depositAmount || 0,
          complimentaryTableSauce: isComplimentaryTableSauce(
            product.category,
            product.name,
          ),
          lunchMenu: product.lunchMenu,
          active: true,
        };
      })
      .sort((left, right) => {
        if (left.categoryOrder !== right.categoryOrder) {
          return left.categoryOrder - right.categoryOrder;
        }

        if (left.campaignActive !== right.campaignActive) {
          return Number(right.campaignActive) - Number(left.campaignActive);
        }

        return left.name.localeCompare(right.name, "de");
      });

    const categories = SCHNELL_CATEGORY_ORDER.filter((category) =>
      products.some((product) => product.category === category),
    ).map((category) => ({
      key: category,
      label: schnellCategoryLabel(category),
    }));

    const payload: CatalogPayload = {
      ok: true,
      source: "db",
      products,
      categories,
      settings: {
        cashEnabled: settings.cashEnabled,
        onlineEnabled: settings.onlineEnabled,
        splitEnabled: settings.splitEnabled,
        takeawayEnabled: settings.takeawayEnabled,
        orderHistoryEnabled: settings.orderHistoryEnabled,
        historyMaxOrders: settings.historyMaxOrders,
        historyDays: settings.historyDays,
        lunchActive: lunchAvailability.active,
        ...(lunchAvailability.availableUntil
          ? { lunchAvailableUntil: lunchAvailability.availableUntil }
          : {}),
        lunchSchedule: {
          enabled: settings.lunchMenu.enabled,
          weekdays: settings.lunchMenu.weekdays,
          startTime: settings.lunchMenu.startTime,
          endTime: settings.lunchMenu.endTime,
          timezone: "Europe/Berlin",
        },
      },
      serverNow: now.toISOString(),
    };

    memoryCache = {
      key: cacheKey,
      expiresAt: Date.now() + CATALOG_MEMORY_TTL_MS,
      payload,
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "private, max-age=30, stale-while-revalidate=120",
        "Server-Timing": "catalog;desc=schnell",
      },
    });
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
      {
        status: 503,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}
