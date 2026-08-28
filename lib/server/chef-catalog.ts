import { getTenantId, prisma } from "@/lib/db";

const CATALOG_VERSION = 3;
const CATALOG_VERSION_KEY = "chef:catalog:version";
const EXTRAS_SOURCE_KEY = "bb_extra_groups_v1";
const EXTRAS_SYNC_KEY = "chef:catalog:extras-source-version";

export const CHEF_CATEGORIES = [
  "Fleisch & Protein",
  "Hähnchen & Snacks",
  "Pommes & Beilagen",
  "Brot",
  "Käse & Spezial",
  "Gemüse & Frische",
  "Soßen",
  "Boxen & Verpackung",
  "Verbrauch & Hygiene",
  "Sonstiges",
] as const;

type Mode = "QUANTITY" | "STATUS";
type CatalogSpec = {
  id: string;
  name: string;
  aliases?: string[];
  category: string;
  mode: Mode;
  unit: string;
  minStock: number | null;
  defaultOrderQty: number | null;
  sortOrder: number;
};

type SettingItem = {
  key: string;
  value: Record<string, any>;
};

const BASE_CATALOG: CatalogSpec[] = [
  { id: "protein-black-angus", name: "Black Angus", aliases: ["Angus"], category: "Fleisch & Protein", mode: "QUANTITY", unit: "Kiste", minStock: 1, defaultOrderQty: null, sortOrder: 10 },
  { id: "protein-burger-fleisch", name: "Burger Fleisch", aliases: ["Normal Fleisch", "Burgerfleisch"], category: "Fleisch & Protein", mode: "QUANTITY", unit: "Kiste", minStock: 2, defaultOrderQty: null, sortOrder: 20 },
  { id: "protein-fit-burger", name: "Fit Burger Fleisch", aliases: ["Fitburger Fleisch", "Fit Burger"], category: "Fleisch & Protein", mode: "QUANTITY", unit: "Kiste", minStock: 1, defaultOrderQty: null, sortOrder: 30 },
  { id: "protein-beyond-meat", name: "Beyond Meat", aliases: ["Beyond", "Vegan Fleisch"], category: "Fleisch & Protein", mode: "QUANTITY", unit: "Karton", minStock: 1, defaultOrderQty: null, sortOrder: 40 },
  { id: "protein-crispy-chicken", name: "Crispy Chicken", aliases: ["Crispy"], category: "Fleisch & Protein", mode: "QUANTITY", unit: "Karton", minStock: 2, defaultOrderQty: null, sortOrder: 50 },

  { id: "snack-chicken-fingers", name: "Chicken Fingers", aliases: ["Chicken Finger"], category: "Hähnchen & Snacks", mode: "QUANTITY", unit: "Karton", minStock: 2, defaultOrderQty: null, sortOrder: 110 },
  { id: "snack-chicken-wings", name: "Chicken Wings", aliases: ["Chicken Wing"], category: "Hähnchen & Snacks", mode: "QUANTITY", unit: "Karton", minStock: 2, defaultOrderQty: null, sortOrder: 120 },
  { id: "snack-mozzarella-sticks", name: "Mozzarella Sticks", aliases: ["Mozzarella Stick"], category: "Hähnchen & Snacks", mode: "QUANTITY", unit: "Karton", minStock: 1, defaultOrderQty: null, sortOrder: 130 },
  { id: "snack-halloumi", name: "Halloumi", category: "Hähnchen & Snacks", mode: "STATUS", unit: "Packung", minStock: null, defaultOrderQty: null, sortOrder: 140 },

  { id: "fries-fries", name: "Fries", aliases: ["Pommes", "Normale Pommes", "Normal Fries"], category: "Pommes & Beilagen", mode: "QUANTITY", unit: "Karton", minStock: 3, defaultOrderQty: null, sortOrder: 210 },
  { id: "fries-curly", name: "Curly Fries", aliases: ["Curly", "Curly Pommes"], category: "Pommes & Beilagen", mode: "QUANTITY", unit: "Karton", minStock: 3, defaultOrderQty: null, sortOrder: 220 },
  { id: "fries-country", name: "Country Potatoes", aliases: ["Country", "Kartoffelecken"], category: "Pommes & Beilagen", mode: "QUANTITY", unit: "Karton", minStock: 2, defaultOrderQty: null, sortOrder: 230 },

  { id: "brot-burger", name: "Burger Brot", aliases: ["Normal Brot", "Burgerbrötchen", "Burgerbroetchen"], category: "Brot", mode: "QUANTITY", unit: "Kiste", minStock: 2, defaultOrderQty: null, sortOrder: 310 },
  { id: "brot-smash", name: "Smash Brot", aliases: ["Smashbrot", "Smash Brötchen", "Smash Broetchen"], category: "Brot", mode: "QUANTITY", unit: "Kiste", minStock: 2, defaultOrderQty: null, sortOrder: 320 },
  { id: "brot-kinder", name: "Kinder Brot", aliases: ["Kinderbrötchen", "Kinderbroetchen"], category: "Brot", mode: "QUANTITY", unit: "Kiste", minStock: 1, defaultOrderQty: null, sortOrder: 330 },
  { id: "brot-hotdog", name: "Hotdog Brot", aliases: ["Hot Dog Brot", "Hotdogbrötchen", "Hotdogbroetchen"], category: "Brot", mode: "QUANTITY", unit: "Kiste", minStock: 1, defaultOrderQty: null, sortOrder: 340 },

  { id: "kaese-mozzarella", name: "Mozzarella", category: "Käse & Spezial", mode: "STATUS", unit: "Packung", minStock: null, defaultOrderQty: null, sortOrder: 410 },
  { id: "kaese-gorgonzola", name: "Gorgonzola", category: "Käse & Spezial", mode: "STATUS", unit: "Packung", minStock: null, defaultOrderQty: null, sortOrder: 420 },
  { id: "kaese-cheddar", name: "Cheddar", category: "Käse & Spezial", mode: "STATUS", unit: "Packung", minStock: null, defaultOrderQty: null, sortOrder: 430 },

  { id: "gemuese-eisberg", name: "Eisbergsalat", aliases: ["Iceberg Salat", "Eisberg"], category: "Gemüse & Frische", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 510 },
  { id: "gemuese-tomaten", name: "Tomaten", category: "Gemüse & Frische", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 520 },
  { id: "gemuese-zwiebeln", name: "Zwiebeln", category: "Gemüse & Frische", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 530 },
  { id: "gemuese-spinat", name: "Spinat", category: "Gemüse & Frische", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 540 },
  { id: "gemuese-avocado", name: "Avocado", category: "Gemüse & Frische", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 550 },
  { id: "gemuese-guacamole", name: "Guacamole", category: "Gemüse & Frische", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 560 },
  { id: "gemuese-jalapenos", name: "Jalapeños", aliases: ["Jalapenos"], category: "Gemüse & Frische", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 570 },
  { id: "gemuese-pickles", name: "Pickles", category: "Gemüse & Frische", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 580 },

  { id: "sauce-ketchup", name: "Ketchup", category: "Soßen", mode: "STATUS", unit: "Karton", minStock: null, defaultOrderQty: 1, sortOrder: 610 },
  { id: "sauce-mayo", name: "Mayonnaise", aliases: ["Mayo"], category: "Soßen", mode: "STATUS", unit: "Karton", minStock: null, defaultOrderQty: 1, sortOrder: 620 },
  { id: "sauce-bb", name: "BB Sauce", aliases: ["BB Soße", "BB Sosse"], category: "Soßen", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 630 },
  { id: "sauce-schwarz", name: "Schwarze Sauce", aliases: ["Schwarze Soße", "Schwarze Sosse"], category: "Soßen", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 640 },
  { id: "sauce-special", name: "Special Sauce", aliases: ["Special Soße", "Special Sosse"], category: "Soßen", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 650 },

  { id: "box-burger", name: "BB Burger Box", category: "Boxen & Verpackung", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 710 },
  { id: "box-kinder", name: "Kinder Box", category: "Boxen & Verpackung", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 720 },
  { id: "box-menu", name: "Menü Box", aliases: ["Menue Box"], category: "Boxen & Verpackung", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 730 },
  { id: "box-pommes", name: "Pommes Box", category: "Boxen & Verpackung", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 740 },
  { id: "box-sauce-cup", name: "Soßenbecher", aliases: ["Sauce Becher"], category: "Boxen & Verpackung", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 750 },
  { id: "box-sauce-lid", name: "Deckel für Soßenbecher", aliases: ["Sauce Becher Deckel"], category: "Boxen & Verpackung", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 760 },
  { id: "box-bags", name: "Papiertüten", category: "Boxen & Verpackung", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 770 },

  { id: "verbrauch-servietten", name: "Servietten", category: "Verbrauch & Hygiene", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 810 },
  { id: "verbrauch-trinkhalme", name: "Trinkhalme", category: "Verbrauch & Hygiene", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 820 },
  { id: "verbrauch-toilettenpapier", name: "Toilettenpapier", category: "Verbrauch & Hygiene", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 830 },
  { id: "verbrauch-handschuhe", name: "Einweghandschuhe", category: "Verbrauch & Hygiene", mode: "STATUS", unit: "", minStock: null, defaultOrderQty: null, sortOrder: 840 },
];

const CATEGORY_MIGRATION: Record<string, string> = {
  "Fleisch & Chicken": "Fleisch & Protein",
  "Chicken & Snacks": "Hähnchen & Snacks",
  Tiefkühl: "Pommes & Beilagen",
  "Fries & Beilagen": "Pommes & Beilagen",
  "Käse & Special": "Käse & Spezial",
  Gemüse: "Gemüse & Frische",
  Saucen: "Soßen",
  Verpackung: "Boxen & Verpackung",
  Verbrauch: "Verbrauch & Hygiene",
  Diğer: "Sonstiges",
};

function normalize(value: unknown) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("de-DE")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’'`´]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonical(value: unknown) {
  let text = normalize(value)
    .replace(/\b\d+\s*(stuck|stueck|pcs?|piece|pieces)\b/g, "")
    .replace(/\b(klein|small|gross|large|normal)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (["pommes", "fries", "normal fries", "normale pommes"].includes(text)) text = "fries";
  if (["chicken finger", "chicken fingers"].includes(text)) text = "chicken fingers";
  if (["mozarella sticks", "mozzarella stick", "mozzarella sticks"].includes(text)) text = "mozzarella sticks";
  if (["chicken wing", "chicken wings"].includes(text)) text = "chicken wings";
  return text;
}

function aliasesOf(value: Record<string, any>) {
  return [value?.name, ...(Array.isArray(value?.voiceAliases) ? value.voiceAliases : [])]
    .map(canonical)
    .filter(Boolean);
}

function uniqueStrings(values: unknown[]) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = String(raw || "").trim();
    const key = normalize(value);
    if (!value || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function classifyExtra(name: string): Pick<CatalogSpec, "category" | "mode" | "unit" | "minStock" | "defaultOrderQty"> | null {
  const n = normalize(name);
  if (!n) return null;

  // These are prepared menu dishes, not purchasing stock articles.
  if (/\b(chili cheese fries|cheese fries)\b/.test(n)) return null;

  if (/\b(curly|fries|pommes|country potatoes|kartoffel|sweet potato|susskart|suesskart)\b/.test(n)) {
    return { category: "Pommes & Beilagen", mode: "QUANTITY", unit: "Karton", minStock: 2, defaultOrderQty: null };
  }
  if (/\b(chicken|chik|wing|finger|nugget|mozzarella stick|zwiebelring|onion ring)\b/.test(n)) {
    return { category: "Hähnchen & Snacks", mode: "QUANTITY", unit: "Karton", minStock: 1, defaultOrderQty: null };
  }
  if (/\b(sauce|sosse|dip|ketchup|mayo|mayonnaise|sour creme|barbecue|bbq|curry)\b/.test(n)) {
    return { category: "Soßen", mode: "STATUS", unit: "Karton", minStock: null, defaultOrderQty: null };
  }
  if (/\bcoleslaw\b/.test(n)) {
    return { category: "Gemüse & Frische", mode: "STATUS", unit: "Packung", minStock: null, defaultOrderQty: null };
  }
  return null;
}

function candidateNames(group: any) {
  if (!group || group.active === false) return [] as string[];
  const groupName = String(group.name || group.title || "").trim();
  const variants = Array.isArray(group.variants)
    ? group.variants
    : Array.isArray(group.items)
      ? group.items
      : [];
  const variantNames = variants
    .filter((variant: any) => variant && variant.active !== false)
    .map((variant: any) => String(variant.name || variant.title || variant.label || "").trim())
    .filter(Boolean);
  const stockVariants = variantNames.filter((name: string) => Boolean(classifyExtra(name)));
  if (stockVariants.length) return stockVariants;
  return classifyExtra(groupName) ? [groupName] : [];
}

async function rowsForChef(tenantId: string): Promise<SettingItem[]> {
  const rows = await prisma.setting.findMany({
    where: { tenantId, key: { startsWith: "chef:item:" } },
    select: { key: true, value: true },
  });
  return rows.map((row) => ({
    key: row.key,
    value: row.value && typeof row.value === "object" && !Array.isArray(row.value) ? (row.value as Record<string, any>) : {},
  }));
}

function findExisting(rows: SettingItem[], spec: CatalogSpec) {
  const accepted = new Set([spec.name, ...(spec.aliases || [])].map(canonical));
  return rows.find((row) => aliasesOf(row.value).some((name) => accepted.has(name)));
}

async function writeItem(tenantId: string, key: string, value: Record<string, any>) {
  await prisma.setting.upsert({
    where: { tenantId_key: { tenantId, key } },
    update: { value },
    create: { tenantId, key, value },
  });
}

async function migrateBaseCatalog(tenantId: string) {
  const versionRow = await prisma.setting.findUnique({
    where: { tenantId_key: { tenantId, key: CATALOG_VERSION_KEY } },
    select: { value: true },
  });
  if (Number(versionRow?.value || 0) >= CATALOG_VERSION) return;

  const rows = await rowsForChef(tenantId);
  const stamp = new Date().toISOString();

  // Remove the placeholder that never existed in the Burger Brothers menu.
  for (const row of rows) {
    if (canonical(row.value?.name) === "mini chicken") {
      const next = { ...row.value, active: false, updatedAt: stamp };
      await writeItem(tenantId, row.key, next);
      row.value = next;
    }
  }

  for (const spec of BASE_CATALOG) {
    const existing = findExisting(rows, spec);
    const old = existing?.value || {};
    const id = String(old.id || spec.id);
    const key = existing?.key || `chef:item:${id}`;
    const next = {
      ...old,
      id,
      name: spec.name,
      category: spec.category,
      mode: spec.mode,
      unit: old.unit || spec.unit,
      minStock: old.minStock ?? spec.minStock,
      defaultOrderQty: old.defaultOrderQty ?? spec.defaultOrderQty,
      supplierName: old.supplierName || "",
      supplierWhatsapp: old.supplierWhatsapp || "",
      voiceAliases: uniqueStrings([...(old.voiceAliases || []), ...(spec.aliases || []), spec.name]),
      active: old.active !== false,
      sortOrder: spec.sortOrder,
      createdAt: old.createdAt || stamp,
      updatedAt: stamp,
    };
    await writeItem(tenantId, key, next);
    if (existing) existing.value = next;
    else rows.push({ key, value: next });
  }

  // Normalize groups of manually created or older stock articles as well.
  for (const row of rows) {
    const oldCategory = String(row.value?.category || "");
    const category = CATEGORY_MIGRATION[oldCategory];
    if (!category || category === oldCategory) continue;
    const next = { ...row.value, category, updatedAt: stamp };
    await writeItem(tenantId, row.key, next);
    row.value = next;
  }

  await prisma.setting.upsert({
    where: { tenantId_key: { tenantId, key: CATALOG_VERSION_KEY } },
    update: { value: CATALOG_VERSION },
    create: { tenantId, key: CATALOG_VERSION_KEY, value: CATALOG_VERSION },
  });
}

async function syncLiveExtras(tenantId: string) {
  const source = await prisma.setting.findFirst({
    where: { tenantId, key: EXTRAS_SOURCE_KEY },
    select: { value: true, updatedAt: true },
  });
  const groups = Array.isArray(source?.value) ? (source?.value as any[]) : [];
  if (!groups.length) return;

  const sourceVersion = `${source?.updatedAt?.toISOString() || "unknown"}:${groups.length}`;
  const syncRow = await prisma.setting.findUnique({
    where: { tenantId_key: { tenantId, key: EXTRAS_SYNC_KEY } },
    select: { value: true },
  });
  if (String(syncRow?.value || "") === sourceVersion) return;

  const names = uniqueStrings(groups.flatMap(candidateNames));
  if (!names.length) return;

  const rows = await rowsForChef(tenantId);
  const stamp = new Date().toISOString();
  const matchedKeys = new Set<string>();
  let order = 0;

  for (const exactName of names) {
    const defaults = classifyExtra(exactName);
    if (!defaults) continue;
    const wanted = canonical(exactName);
    const existing = rows.find((row) => aliasesOf(row.value).includes(wanted));
    const old = existing?.value || {};
    const id = String(old.id || `extras-${wanted.replace(/\s+/g, "-").slice(0, 72)}`);
    const key = existing?.key || `chef:item:${id}`;
    const next = {
      ...old,
      id,
      name: exactName,
      category: defaults.category,
      mode: old.mode === "STATUS" || old.mode === "QUANTITY" ? old.mode : defaults.mode,
      unit: old.unit || defaults.unit,
      minStock: old.minStock ?? defaults.minStock,
      defaultOrderQty: old.defaultOrderQty ?? defaults.defaultOrderQty,
      supplierName: old.supplierName || "",
      supplierWhatsapp: old.supplierWhatsapp || "",
      voiceAliases: uniqueStrings([...(old.voiceAliases || []), exactName]),
      source: old.source || "menu-extras",
      active: true,
      sortOrder: Number.isFinite(Number(old.sortOrder)) && Number(old.sortOrder) < 900 ? old.sortOrder : 200 + order,
      createdAt: old.createdAt || stamp,
      updatedAt: stamp,
    };
    order += 1;
    await writeItem(tenantId, key, next);
    matchedKeys.add(key);
    if (existing) existing.value = next;
    else rows.push({ key, value: next });
  }

  for (const row of rows) {
    if (row.value?.source !== "menu-extras" || matchedKeys.has(row.key) || row.value?.active === false) continue;
    await writeItem(tenantId, row.key, { ...row.value, active: false, updatedAt: stamp });
  }

  await prisma.setting.upsert({
    where: { tenantId_key: { tenantId, key: EXTRAS_SYNC_KEY } },
    update: { value: sourceVersion },
    create: { tenantId, key: EXTRAS_SYNC_KEY, value: sourceVersion },
  });
}

export async function ensureChefCatalog() {
  const tenantId = await getTenantId();
  await migrateBaseCatalog(tenantId);
  await syncLiveExtras(tenantId);
}
