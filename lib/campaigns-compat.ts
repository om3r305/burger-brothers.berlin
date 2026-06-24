// lib/campaigns-compat.ts
import { siteConfig } from "@/config/site.config";
import type { Campaign, Category } from "@/lib/catalog";

const LS_CAMPAIGNS = "bb_campaigns_v1";

/* ---------- yardımcılar ---------- */

function hasWindow() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function makeId() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {}

  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toISO(input: any): string | undefined {
  if (!input && input !== 0) return undefined;

  if (
    typeof input === "number" ||
    (/^\d+$/.test(String(input)) && String(input).length > 5)
  ) {
    const d = new Date(Number(input));
    return Number.isFinite(d.valueOf()) ? d.toISOString() : undefined;
  }

  if (typeof input === "string") {
    const tryDate = new Date(input);
    if (Number.isFinite(tryDate.valueOf())) return tryDate.toISOString();

    const m = input.match(
      /^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/
    );

    if (m) {
      const [, dd, MM, yyyy, hh = "00", mm = "00", ss = "00"] = m;
      const iso = new Date(
        Number(yyyy),
        Number(MM) - 1,
        Number(dd),
        Number(hh),
        Number(mm),
        Number(ss)
      );

      return Number.isFinite(iso.valueOf()) ? iso.toISOString() : undefined;
    }
  }

  return undefined;
}

function mapMode(mode: any): Campaign["mode"] {
  if (!mode) return "both";

  if (typeof mode === "object") {
    const delivery = !!(mode.delivery ?? mode.lieferung ?? mode.liefa ?? mode.lifa);
    const pickup = !!(mode.pickup ?? mode.abholung ?? mode.apollon ?? mode.apollo);

    if (delivery && pickup) return "both";
    if (delivery) return "delivery";
    if (pickup) return "pickup";

    return "both";
  }

  const s = String(mode).toLowerCase().trim();

  if (["both", "her ikisi", "ikisi", "alle", "beide"].some((key) => s.includes(key))) {
    return "both";
  }

  const hasDelivery = /(liefer|lieferung|delivery|lifa|liefa)/.test(s);
  const hasPickup = /(abhol|abholung|pickup|apollon|apollo)/.test(s);

  if (hasDelivery && hasPickup) return "both";
  if (hasDelivery) return "delivery";
  if (hasPickup) return "pickup";

  return s === "delivery" ? "delivery" : s === "pickup" ? "pickup" : "both";
}

function mapCategory(value: any): Category | undefined {
  if (!value) return undefined;

  const s = String(value).toLowerCase().trim();

  const pairs: Array<[RegExp, Category]> = [
    [/^burger$/, "burger"],
    [/^(vegan|vegetar)/, "vegan"],
    [/^(extra|snack|pommes|fries|nugget|onion|country)/, "extras"],
    [/^(sauce|soß|soss|sossen|sos)/, "sauces"],
    [/^(drink|getränk|getraenk|cola|fritz|ayran|wasser|water|ice ?tea|fanta|sprite|mezzo)/, "drinks"],
    [/^hot[\s-]?dogs?$/, "hotdogs"],
    [/^(donut|doughnut|dessert)/, "donuts"],
    [/^(bubble|bubbletea|bubble tea|boba)/, "bubbletea"],
  ];

  for (const [regex, category] of pairs) {
    if (regex.test(s)) return category;
  }

  return undefined;
}

/* Tüm ürün id’lerini topla */
function pickProductIds(campaign: any): string[] {
  const out: string[] = [];

  if (Array.isArray(campaign?.productIds)) {
    for (const value of campaign.productIds) {
      const id = String(value ?? "").trim();
      if (id) out.push(id);
    }
  }

  if (Array.isArray(campaign?.products)) {
    for (const product of campaign.products) {
      const id = String(
        product?.id ?? product?.sku ?? product?.code ?? product?.name ?? ""
      ).trim();

      if (id) out.push(id);
    }
  }

  const single =
    campaign?.productId ??
    campaign?.sku ??
    campaign?.code ??
    campaign?.targetProductId ??
    campaign?.targetId;

  if (single) {
    const id = String(single).trim();
    if (id) out.push(id);
  }

  return Array.from(new Set(out));
}

function normalizeConfigCampaign(campaign: Campaign): Campaign {
  return {
    ...campaign,
    id: String(campaign.id ?? makeId()),
    name: String(campaign.name ?? "Aktion"),
    type: campaign.type,
    percent: Math.max(0, Math.min(100, Number(campaign.percent) || 0)),
    targetCategory: campaign.targetCategory ? mapCategory(campaign.targetCategory) : undefined,
    targetProductId: campaign.targetProductId
      ? String(campaign.targetProductId)
      : undefined,
    productIds: Array.isArray(campaign.productIds)
      ? campaign.productIds.map(String).filter(Boolean)
      : undefined,
    mode: mapMode(campaign.mode),
    active: campaign.active !== false,
    startsAt: toISO(campaign.startsAt),
    endsAt: toISO(campaign.endsAt),
    priority: Number(campaign.priority ?? 0) || 0,
    badgeText: campaign.badgeText || undefined,
  };
}

/* ---------- normalize ---------- */

export function loadNormalizedCampaigns(): Campaign[] {
  const fromConfigRaw = ((siteConfig as any).promotions || []) as Campaign[];
  const fromConfig = Array.isArray(fromConfigRaw)
    ? fromConfigRaw.map(normalizeConfigCampaign)
    : [];

  let fromAdmin: Campaign[] = [];

  try {
    if (!hasWindow()) return fromConfig;

    const raw = localStorage.getItem(LS_CAMPAIGNS);
    const arr = raw ? JSON.parse(raw) : [];

    if (Array.isArray(arr)) {
      fromAdmin = arr.map((campaign: any) => {
        const scope = campaign?.scope ?? campaign?.target ?? campaign?.typeScope;
        const kind = campaign?.kind ?? campaign?.valueType ?? "percent";
        const rawValue = Number(campaign?.value ?? campaign?.amount ?? campaign?.percent ?? 0);

        const scopeText = String(scope ?? "").toLowerCase();

        const type: Campaign["type"] =
          scopeText.startsWith("product") ||
          Array.isArray(campaign?.productIds) ||
          Array.isArray(campaign?.products) ||
          campaign?.productId ||
          campaign?.targetProductId
            ? "percentOffProduct"
            : "percentOffCategory";

        const percent =
          String(kind).toLowerCase() === "percent"
            ? Math.max(0, Math.min(100, rawValue))
            : 0;

        let targetCategory: Category | undefined;

        if (type === "percentOffCategory") {
          if (Array.isArray(campaign?.categories) && campaign.categories.length) {
            targetCategory = mapCategory(campaign.categories[0]);
          } else if (campaign?.category) {
            targetCategory = mapCategory(campaign.category);
          } else if (campaign?.targetCategory) {
            targetCategory = mapCategory(campaign.targetCategory);
          }
        }

        const productIds = type === "percentOffProduct" ? pickProductIds(campaign) : [];
        const targetProductId = productIds.length ? productIds[0] : undefined;

        const startsAt =
          toISO(campaign?.startsAt) ??
          toISO(campaign?.startAt) ??
          toISO(campaign?.start) ??
          toISO(campaign?.from);

        const endsAt =
          toISO(campaign?.endsAt) ??
          toISO(campaign?.endAt) ??
          toISO(campaign?.end) ??
          toISO(campaign?.until) ??
          toISO(campaign?.to);

        return {
          id: String(campaign?.id ?? makeId()),
          name: String(campaign?.name ?? campaign?.title ?? "Aktion"),
          type,
          percent,
          targetCategory,
          targetProductId,
          productIds: productIds.length ? productIds : undefined,
          mode: mapMode(campaign?.mode),
          active: campaign?.enabled !== false && campaign?.active !== false,
          startsAt,
          endsAt,
          priority: Number(campaign?.priority ?? campaign?.prio ?? 0) || 0,
          badgeText:
            campaign?.badge ||
            campaign?.badgeText ||
            campaign?.label ||
            undefined,
        } as Campaign;
      });
    }
  } catch {}

  return [...fromAdmin, ...fromConfig];
}