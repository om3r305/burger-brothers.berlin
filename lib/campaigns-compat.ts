// lib/campaigns-compat.ts
import { siteConfig } from "@/config/site.config";
import type { Campaign, Category } from "@/lib/catalog";

const LS_CAMPAIGNS = "bb_campaigns_v1";

/* ---------- yardımcılar ---------- */
function toISO(input: any): string | undefined {
  if (!input && input !== 0) return undefined;
  if (typeof input === "number" || (/^\d+$/.test(String(input)) && String(input).length > 5)) {
    const d = new Date(Number(input));
    return isNaN(+d) ? undefined : d.toISOString();
  }
  if (typeof input === "string") {
    const tryDate = new Date(input);
    if (!isNaN(+tryDate)) return tryDate.toISOString();
    const m = input.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m) {
      const [, dd, MM, yyyy, hh = "00", mm = "00", ss = "00"] = m;
      const iso = new Date(Number(yyyy), Number(MM) - 1, Number(dd), Number(hh), Number(mm), Number(ss));
      return isNaN(+iso) ? undefined : iso.toISOString();
    }
  }
  return undefined;
}

function mapMode(m: any): Campaign["mode"] {
  if (!m) return "both";
  if (typeof m === "object") {
    const d = !!(m.delivery ?? m.lieferung ?? m.liefa);
    const p = !!(m.pickup ?? m.abholung ?? m.apollon);
    if (d && p) return "both";
    if (d) return "delivery";
    if (p) return "pickup";
    return "both";
  }
  const s = String(m).toLowerCase().trim();
  if (["both","her ikisi","ikisi","alle","beide"].some(k => s.includes(k))) return "both";
  if (/(liefer|lieferung|delivery|lifa)/.test(s) && !/(abhol|abholung|pickup|apollon)/.test(s)) return "delivery";
  if (/(abhol|abholung|pickup|apollon)/.test(s) && !/(liefer|lieferung|delivery|lifa)/.test(s)) return "pickup";
  if (/(liefer|delivery|lifa)/.test(s) && /(abhol|pickup|apollon)/.test(s)) return "both";
  return s === "delivery" ? "delivery" : s === "pickup" ? "pickup" : "both";
}

function mapCategory(val: any): Category | undefined {
  if (!val) return undefined;
  const s = String(val).toLowerCase().trim();
  const pairs: Array<[RegExp, Category]> = [
    [/^burger$/, "burger"],
    [/^(vegan|vegetar)/, "vegan"],
    [/^(extra|snack|pommes|fries|nugget|onion|country)/, "extras"],
    [/^(sauce|soß|soss|sossen)/, "sauces"],
    [/^(drink|getränk|cola|fritz|ayran|wasser|water|ice ?tea|fanta|sprite|mezzo)/, "drinks"],
    [/^hot[\s-]?dogs?$/, "hotdogs"],
  ];
  for (const [re, cat] of pairs) if (re.test(s)) return cat;
  return undefined;
}

/* 🔧 TÜM ürün id’lerini topla (sadece ilki değil) */
function pickProductIds(c: any): string[] {
  const out: string[] = [];

  if (Array.isArray(c?.productIds)) {
    for (const x of c.productIds) {
      const id = String(x ?? "").trim();
      if (id) out.push(id);
    }
  }
  if (Array.isArray(c?.products)) {
    for (const p of c.products) {
      const id = String(p?.id ?? p?.sku ?? p?.code ?? p?.name ?? "").trim();
      if (id) out.push(id);
    }
  }
  const single = c?.productId ?? c?.sku ?? c?.code ?? c?.name ?? c?.targetId;
  if (single) {
    const id = String(single).trim();
    if (id) out.push(id);
  }
  return Array.from(new Set(out));
}

/* ---------- normalize ---------- */
export function loadNormalizedCampaigns(): Campaign[] {
  const fromConfig = ((siteConfig as any).promotions || []) as Campaign[];

  let fromAdmin: Campaign[] = [];
  try {
    const raw = localStorage.getItem(LS_CAMPAIGNS);
    const arr = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr)) {
      fromAdmin = arr.map((c: any) => {
        const scope = c?.scope ?? c?.target ?? c?.typeScope;
        const kind = c?.kind ?? c?.valueType ?? "percent";
        const rawValue = Number(c?.value ?? c?.amount ?? c?.percent ?? 0);

        const type: Campaign["type"] =
          String(scope).toLowerCase().startsWith("product") ? "percentOffProduct" : "percentOffCategory";

        const percent = String(kind).toLowerCase() === "percent"
          ? Math.max(0, Math.min(100, rawValue))
          : 0;

        let targetCategory: Category | undefined;
        if (type === "percentOffCategory") {
          if (Array.isArray(c?.categories) && c.categories.length) targetCategory = mapCategory(c.categories[0]);
          else if (c?.category) targetCategory = mapCategory(c.category);
        }

        const productIds = type === "percentOffProduct" ? pickProductIds(c) : [];
        const targetProductId = productIds.length ? productIds[0] : undefined;

        const startsAt = toISO(c?.startsAt) ?? toISO(c?.startAt) ?? toISO(c?.start) ?? toISO(c?.from);
        const endsAt   = toISO(c?.endsAt)   ?? toISO(c?.endAt)   ?? toISO(c?.end)   ?? toISO(c?.until) ?? toISO(c?.to);

        return {
          id: String(c?.id ?? (globalThis.crypto?.randomUUID?.() ?? Date.now())),
          name: String(c?.name ?? c?.title ?? "Aktion"),
          type,
          percent,
          targetCategory,
          targetProductId,                          // geri uyumluluk
          productIds: productIds.length ? productIds : undefined, // ✅ çoklu ürün desteği
          mode: mapMode(c?.mode),
          active: c?.enabled !== false && c?.active !== false,
          startsAt, endsAt,
          priority: Number(c?.priority ?? c?.prio ?? 0) || 0,
          badgeText: c?.badge || c?.badgeText || c?.label || undefined,
        } as Campaign;
      });
    }
  } catch {}

  return [...fromAdmin, ...fromConfig];
}
