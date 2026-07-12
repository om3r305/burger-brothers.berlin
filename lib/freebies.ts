// lib/freebies.ts
// Merkezi, kümülatif Gratis-Artikel kural motoru.
// Eski category/mode/tiers yapısını da geriye dönük destekler.

export type FreebieCategory = "sauces" | "drinks" | "donuts" | "bubbletea";
export type FreebieMode = "pickup" | "delivery" | "both";

export type FreebieRule = {
  id: string;
  enabled: boolean;
  category: FreebieCategory;
  mode: FreebieMode;
  minTotal: number;
  quantity: number;
  maxProductPrice: number | null;
  [key: string]: any;
};

export type FreebieUnit = {
  unitId: string;
  category: FreebieCategory;
  price: number;
  [key: string]: any;
};

export type FreebieRuleState = FreebieRule & {
  unlocked: boolean;
  allowed: number;
  used: number;
  remaining: number;
  discountedAmount: number;
  missingAmount: number;
};

export type FreebieEvaluation = {
  enabled: boolean;
  allowed: number;
  used: number;
  remaining: number;
  discountedAmount: number;
  thresholds: number[];
  category?: FreebieCategory;
  rules: FreebieRuleState[];
};

function toNumber(value: any, fallback = 0) {
  const n = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

function toBool(value: any, fallback = true) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null || value === "") return fallback;

  const text = String(value).toLowerCase().trim();
  if (["1", "true", "yes", "ja", "on", "aktiv"].includes(text)) return true;
  if (["0", "false", "no", "nein", "off", "inaktiv"].includes(text)) return false;

  return fallback;
}

function makeRuleId(index: number, raw?: any) {
  const direct = String(raw?.id ?? "").trim();
  if (direct) return direct;

  const category = normalizeFreebieCategory(raw?.category);
  const mode = normalizeFreebieMode(raw?.mode);
  const min = Math.max(0, toNumber(raw?.minTotal, 0));

  return `freebie-${category}-${mode}-${min}-${index + 1}`;
}

export function parseFreebieCategory(value: any): FreebieCategory | null {
  const text = String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, "");

  if (
    text === "sauces" ||
    text === "sauce" ||
    text === "soße" ||
    text === "soßen" ||
    text === "sosse" ||
    text === "sossen" ||
    text === "sos"
  ) {
    return "sauces";
  }

  if (
    text === "drinks" ||
    text === "drink" ||
    text === "getränke" ||
    text === "getraenke"
  ) {
    return "drinks";
  }

  if (
    text === "donuts" ||
    text === "donut" ||
    text === "doughnuts" ||
    text === "doughnut"
  ) {
    return "donuts";
  }

  if (text === "bubbletea" || text === "boba" || text === "milktea") {
    return "bubbletea";
  }

  return null;
}

export function normalizeFreebieCategory(value: any): FreebieCategory {
  return parseFreebieCategory(value) || "sauces";
}

export function normalizeFreebieMode(value: any): FreebieMode {
  const text = String(value ?? "").toLowerCase().trim();

  if (
    text === "pickup" ||
    text === "abholung" ||
    text === "apollo" ||
    text === "apollon"
  ) {
    return "pickup";
  }

  if (
    text === "delivery" ||
    text === "lieferung" ||
    text === "lifa" ||
    text === "liefa"
  ) {
    return "delivery";
  }

  return "both";
}

export function freebieCategoryLabel(category: any, plural = false) {
  const key = normalizeFreebieCategory(category);

  if (key === "drinks") return plural ? "Getränke" : "Getränk";
  if (key === "donuts") return plural ? "Donuts" : "Donut";
  if (key === "bubbletea") return plural ? "Bubble Teas" : "Bubble Tea";

  return plural ? "Soßen" : "Soße";
}

export function freebieModeLabel(mode: any) {
  const key = normalizeFreebieMode(mode);

  if (key === "pickup") return "Abholung";
  if (key === "delivery") return "Lieferung";

  return "Beide";
}

export function normalizeFreebieRules(config: any): FreebieRule[] {
  const raw = config || {};
  const sourceRules = Array.isArray(raw.rules) ? raw.rules : [];

  if (sourceRules.length > 0) {
    return sourceRules
      .map((entry: any, index: number) => {
        const maxRaw =
          entry?.maxProductPrice ??
          entry?.maxPrice ??
          entry?.priceLimit ??
          entry?.maxItemPrice;

        const maxNumber =
          maxRaw === "" || maxRaw === null || maxRaw === undefined
            ? null
            : Math.max(0, toNumber(maxRaw, 0));

        return {
          ...entry,
          id: makeRuleId(index, entry),
          enabled: toBool(entry?.enabled ?? entry?.active, true),
          category: normalizeFreebieCategory(entry?.category),
          mode: normalizeFreebieMode(entry?.mode),
          minTotal: Math.max(0, toNumber(entry?.minTotal ?? entry?.minimumTotal, 0)),
          quantity: Math.max(
            0,
            Math.floor(
              toNumber(
                entry?.quantity ??
                  entry?.freeItems ??
                  entry?.freeCount ??
                  entry?.freeSauces,
                0,
              ),
            ),
          ),
          maxProductPrice: maxNumber && maxNumber > 0 ? maxNumber : null,
        } satisfies FreebieRule;
      })
      .filter((rule: FreebieRule) => rule.minTotal > 0 && rule.quantity > 0);
  }

  // Legacy uyumluluğu: category + mode + tiers
  const category = normalizeFreebieCategory(raw.category);
  const mode = normalizeFreebieMode(raw.mode);
  const tiers = Array.isArray(raw.tiers) ? raw.tiers : [];

  return tiers
    .map((tier: any, index: number) => ({
      id: makeRuleId(index, {
        ...tier,
        category,
        mode,
      }),
      enabled: true,
      category,
      mode,
      minTotal: Math.max(0, toNumber(tier?.minTotal, 0)),
      quantity: Math.max(
        0,
        Math.floor(
          toNumber(
            tier?.quantity ?? tier?.freeItems ?? tier?.freeSauces,
            0,
          ),
        ),
      ),
      maxProductPrice: null,
      legacyTier: true,
    }))
    .filter((rule: FreebieRule) => rule.minTotal > 0 && rule.quantity > 0);
}

export function normalizeFreebieConfig(config: any) {
  const raw = config || {};
  const rules = normalizeFreebieRules(raw);

  const first = rules[0] || null;
  const legacyRules = first
    ? rules.filter(
        (rule) =>
          rule.category === first.category &&
          rule.mode === first.mode,
      )
    : [];

  return {
    ...raw,
    enabled: toBool(raw.enabled, false),
    rules,
    // Eski client sürümleri için ilk kategori/mod kopyası korunur.
    category: first?.category ?? normalizeFreebieCategory(raw.category),
    mode: first?.mode ?? normalizeFreebieMode(raw.mode),
    tiers: legacyRules.map((rule) => ({
      minTotal: rule.minTotal,
      freeSauces: rule.quantity,
    })),
  };
}

function emptyEvaluation(): FreebieEvaluation {
  return {
    enabled: false,
    allowed: 0,
    used: 0,
    remaining: 0,
    discountedAmount: 0,
    thresholds: [],
    category: undefined,
    rules: [],
  };
}

export function evaluateFreebieRules(params: {
  config: any;
  mode: "pickup" | "delivery";
  merchandise: number;
  units: FreebieUnit[];
}): FreebieEvaluation {
  const config = normalizeFreebieConfig(params.config);

  if (!config.enabled || !config.rules.length) {
    return emptyEvaluation();
  }

  const mode = params.mode;
  const merchandise = Math.max(0, toNumber(params.merchandise, 0));

  const rules = config.rules
    .filter(
      (rule: FreebieRule) =>
        rule.enabled &&
        (rule.mode === "both" || rule.mode === mode),
    )
    .map((rule: FreebieRule, index: number) => ({ rule, index }))
    .sort(
      (a: any, b: any) =>
        a.rule.minTotal - b.rule.minTotal ||
        a.index - b.index,
    );

  if (!rules.length) {
    return {
      ...emptyEvaluation(),
      enabled: true,
    };
  }

  const allUnits = (Array.isArray(params.units) ? params.units : [])
    .map((unit) => ({
      ...unit,
      unitId: String(unit?.unitId ?? ""),
      category: parseFreebieCategory(unit?.category),
      price: Math.max(0, toNumber(unit?.price, 0)),
    }))
    .filter(
      (unit): unit is FreebieUnit =>
        Boolean(unit.unitId && unit.category),
    );

  const consumedUnitIds = new Set<string>();
  const states: FreebieRuleState[] = [];
  let discountedAmount = 0;

  for (const { rule } of rules) {
    const candidates = allUnits
      .filter((unit) => {
        if (consumedUnitIds.has(unit.unitId)) return false;
        if (unit.category !== rule.category) return false;

        if (
          rule.maxProductPrice != null &&
          unit.price - rule.maxProductPrice > 0.000001
        ) {
          return false;
        }

        return true;
      })
      .sort((a, b) => a.price - b.price);

    const selected = candidates.slice(0, rule.quantity);
    const potentialDiscount = selected.reduce(
      (sum, unit) => sum + unit.price,
      0,
    );

    /*
      Minimum değer, hediyeler düşüldükten sonra da korunur.
      Örnek: 18 € ürün + 2 € sos, 20 € kampanyasını kendi kendine açamaz.
      20 € normal ürün + 2 € sos ise 22 - 2 = 20 olduğu için açılır.
    */
    const netAfterPotentialGift =
      merchandise - discountedAmount - potentialDiscount;

    const unlocked = netAfterPotentialGift + 0.000001 >= rule.minTotal;

    if (unlocked) {
      for (const unit of selected) {
        consumedUnitIds.add(unit.unitId);
      }

      discountedAmount += potentialDiscount;
    }

    const used = unlocked ? selected.length : 0;
    const allowed = unlocked ? rule.quantity : 0;
    const remaining = unlocked ? Math.max(0, allowed - used) : 0;

    const baseForMissing =
      merchandise -
      discountedAmount -
      (unlocked ? 0 : potentialDiscount);

    states.push({
      ...rule,
      unlocked,
      allowed,
      used,
      remaining,
      discountedAmount: unlocked ? potentialDiscount : 0,
      missingAmount: unlocked
        ? 0
        : Math.max(0, rule.minTotal - baseForMissing),
    });
  }

  const allowed = states.reduce((sum, rule) => sum + rule.allowed, 0);
  const used = states.reduce((sum, rule) => sum + rule.used, 0);

  return {
    enabled: true,
    allowed,
    used,
    remaining: Math.max(0, allowed - used),
    discountedAmount: +discountedAmount.toFixed(2),
    thresholds: Array.from(
      new Set(states.map((rule) => rule.minTotal)),
    ).sort((a, b) => a - b),
    category:
      states.length === 1 ? states[0].category : undefined,
    rules: states,
  };
}
