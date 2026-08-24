export type BurgerStudioGroup = "bun" | "protein" | "cheese" | "topping" | "sauce";

export type BurgerStudioIngredient = {
  id: string;
  name: string;
  group: BurgerStudioGroup;
  addPrice: number;
  removeCredit: number;
  max: number;
  active: boolean;
  vegan?: boolean;
  visual?: string;
};

export type BurgerStudioTemplate = {
  id: string;
  name: string;
  productRef: string;
  description?: string;
  active: boolean;
  recipe: Record<string, number>;
};

export type BurgerStudioConfig = {
  version: 1;
  enabled: boolean;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  scratchEnabled: boolean;
  savedBurgersEnabled: boolean;
  scratchBasePrice: number;
  maxIngredients: number;
  maxSavedBurgers: number;
  ingredients: BurgerStudioIngredient[];
  templates: BurgerStudioTemplate[];
};

export type BurgerStudioRecipe = {
  version: 1;
  templateId: string | null;
  ingredients: Record<string, number>;
};

export type BurgerStudioQuoteLine = {
  ingredient: BurgerStudioIngredient;
  qty: number;
  baseQty: number;
  deltaQty: number;
  amount: number;
};

export type BurgerStudioQuote = {
  basePrice: number;
  delta: number;
  total: number;
  selected: Array<{ ingredient: BurgerStudioIngredient; qty: number }>;
  removed: Array<{ ingredient: BurgerStudioIngredient; qty: number }>;
  lines: BurgerStudioQuoteLine[];
};

const GROUPS = new Set<BurgerStudioGroup>([
  "bun",
  "protein",
  "cheese",
  "topping",
  "sauce",
]);

function finiteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function money(value: unknown, fallback = 0) {
  return Math.max(0, Math.round(finiteNumber(value, fallback) * 100) / 100);
}

function safeId(value: unknown, fallback: string) {
  const text = String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return text || fallback;
}

export const DEFAULT_BURGER_STUDIO_INGREDIENTS: BurgerStudioIngredient[] = [
  { id: "brioche", name: "Brioche Bun", group: "bun", addPrice: 0, removeCredit: 0, max: 1, active: true, vegan: false, visual: "bun" },
  { id: "beef", name: "Beef Patty", group: "protein", addPrice: 3.5, removeCredit: 3, max: 3, active: true, visual: "beef" },
  { id: "crispy", name: "Crispy Chicken", group: "protein", addPrice: 3.5, removeCredit: 3, max: 3, active: true, visual: "crispy" },
  { id: "vegan-patty", name: "Vegan Patty", group: "protein", addPrice: 3.5, removeCredit: 3, max: 3, active: true, vegan: true, visual: "vegan" },
  { id: "cheddar", name: "Cheddar", group: "cheese", addPrice: 1, removeCredit: 0, max: 3, active: true, visual: "cheddar" },
  { id: "gouda", name: "Gouda", group: "cheese", addPrice: 1, removeCredit: 0, max: 3, active: true, visual: "gouda" },
  { id: "mozzarella", name: "Mozzarella", group: "cheese", addPrice: 1.2, removeCredit: 0, max: 3, active: true, visual: "mozzarella" },
  { id: "gorgonzola", name: "Gorgonzola", group: "cheese", addPrice: 1.5, removeCredit: 0, max: 2, active: true, visual: "gorgonzola" },
  { id: "bacon", name: "Bacon", group: "topping", addPrice: 1.5, removeCredit: 0, max: 3, active: true, visual: "bacon" },
  { id: "jalapenos", name: "Jalapeños", group: "topping", addPrice: 0.7, removeCredit: 0, max: 2, active: true, vegan: true, visual: "jalapeno" },
  { id: "roestzwiebeln", name: "Röstzwiebeln", group: "topping", addPrice: 0.7, removeCredit: 0, max: 2, active: true, vegan: true, visual: "onion" },
  { id: "zwiebeln", name: "Zwiebeln", group: "topping", addPrice: 0.5, removeCredit: 0, max: 2, active: true, vegan: true, visual: "onion" },
  { id: "salat", name: "Salat", group: "topping", addPrice: 0.4, removeCredit: 0, max: 2, active: true, vegan: true, visual: "lettuce" },
  { id: "tomate", name: "Tomate", group: "topping", addPrice: 0.5, removeCredit: 0, max: 2, active: true, vegan: true, visual: "tomato" },
  { id: "gurke", name: "Gurke", group: "topping", addPrice: 0.5, removeCredit: 0, max: 2, active: true, vegan: true, visual: "pickle" },
  { id: "guacamole", name: "Guacamole", group: "topping", addPrice: 1.5, removeCredit: 0, max: 2, active: true, vegan: true, visual: "guacamole" },
  { id: "bb-sauce", name: "BB Sauce", group: "sauce", addPrice: 0.8, removeCredit: 0, max: 2, active: true, visual: "sauce" },
  { id: "italian-sauce", name: "Italian Sauce", group: "sauce", addPrice: 0.8, removeCredit: 0, max: 2, active: true, visual: "sauce" },
  { id: "avocado-sauce", name: "Avocado Sauce", group: "sauce", addPrice: 1, removeCredit: 0, max: 2, active: true, vegan: true, visual: "avocado-sauce" },
  { id: "bbq", name: "BBQ Sauce", group: "sauce", addPrice: 0.8, removeCredit: 0, max: 2, active: true, vegan: true, visual: "bbq" },
];

export function createDefaultBurgerStudioConfig(): BurgerStudioConfig {
  return {
    version: 1,
    enabled: false,
    pickupEnabled: true,
    deliveryEnabled: true,
    scratchEnabled: true,
    savedBurgersEnabled: true,
    scratchBasePrice: 3.5,
    maxIngredients: 18,
    maxSavedBurgers: 8,
    ingredients: DEFAULT_BURGER_STUDIO_INGREDIENTS.map((item) => ({ ...item })),
    templates: [],
  };
}

function normalizeIngredient(value: any, index: number): BurgerStudioIngredient | null {
  if (!value || typeof value !== "object") return null;
  const id = safeId(value.id ?? value.name, `ingredient-${index + 1}`);
  const name = String(value.name ?? value.label ?? id).trim().slice(0, 80);
  const group = String(value.group ?? "topping") as BurgerStudioGroup;
  if (!GROUPS.has(group)) return null;

  return {
    id,
    name: name || id,
    group,
    addPrice: money(value.addPrice ?? value.price, 0),
    removeCredit: money(value.removeCredit, 0),
    max: Math.min(6, Math.max(1, Math.round(finiteNumber(value.max, 1)))),
    active: value.active !== false,
    vegan: value.vegan === true,
    visual: String(value.visual ?? id).trim().slice(0, 60) || id,
  };
}

function normalizeRecipeMap(value: any) {
  const out: Record<string, number> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [rawKey, rawQty] of Object.entries(value)) {
    const key = safeId(rawKey, "");
    if (!key) continue;
    const qty = Math.max(0, Math.min(6, Math.round(finiteNumber(rawQty, 0))));
    if (qty > 0) out[key] = qty;
  }
  return out;
}

function normalizeTemplate(value: any, index: number): BurgerStudioTemplate | null {
  if (!value || typeof value !== "object") return null;
  const id = safeId(value.id ?? value.name, `template-${index + 1}`);
  const name = String(value.name ?? "Burger Vorlage").trim().slice(0, 80);
  const productRef = String(value.productRef ?? value.productId ?? value.sku ?? "").trim().slice(0, 160);
  if (!productRef) return null;
  return {
    id,
    name: name || "Burger Vorlage",
    productRef,
    description: value.description ? String(value.description).slice(0, 180) : undefined,
    active: value.active !== false,
    recipe: normalizeRecipeMap(value.recipe),
  };
}

export function normalizeBurgerStudioConfig(value: any): BurgerStudioConfig {
  const defaults = createDefaultBurgerStudioConfig();
  const root: Record<string, any> =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const ingredientsRaw: any[] = Array.isArray(root.ingredients)
    ? root.ingredients
    : defaults.ingredients;
  const ingredients: BurgerStudioIngredient[] = ingredientsRaw
    .map((item: any, index: number) => normalizeIngredient(item, index))
    .filter(
      (item: BurgerStudioIngredient | null): item is BurgerStudioIngredient =>
        item !== null,
    );
  const uniqueIngredientsMap = new Map<string, BurgerStudioIngredient>();
  for (const item of ingredients) uniqueIngredientsMap.set(item.id, item);
  const uniqueIngredients: BurgerStudioIngredient[] = Array.from(
    uniqueIngredientsMap.values(),
  );

  const templatesRaw: any[] = Array.isArray(root.templates) ? root.templates : [];
  const templates: BurgerStudioTemplate[] = templatesRaw
    .map((item: any, index: number) => normalizeTemplate(item, index))
    .filter(
      (item: BurgerStudioTemplate | null): item is BurgerStudioTemplate =>
        item !== null,
    );
  const uniqueTemplatesMap = new Map<string, BurgerStudioTemplate>();
  for (const item of templates) uniqueTemplatesMap.set(item.id, item);
  const uniqueTemplates: BurgerStudioTemplate[] = Array.from(
    uniqueTemplatesMap.values(),
  );

  return {
    version: 1,
    enabled: root.enabled === true,
    pickupEnabled: root.pickupEnabled !== false,
    deliveryEnabled: root.deliveryEnabled !== false,
    scratchEnabled: root.scratchEnabled !== false,
    savedBurgersEnabled: root.savedBurgersEnabled !== false,
    scratchBasePrice: money(root.scratchBasePrice, defaults.scratchBasePrice),
    maxIngredients: Math.min(
      40,
      Math.max(
        1,
        Math.round(finiteNumber(root.maxIngredients, defaults.maxIngredients)),
      ),
    ),
    maxSavedBurgers: Math.min(
      30,
      Math.max(
        1,
        Math.round(finiteNumber(root.maxSavedBurgers, defaults.maxSavedBurgers)),
      ),
    ),
    ingredients: uniqueIngredients.length
      ? uniqueIngredients
      : defaults.ingredients,
    templates: uniqueTemplates,
  };
}

export function normalizeBurgerStudioRecipe(value: any): BurgerStudioRecipe {
  const root: Record<string, any> =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    version: 1,
    templateId: root.templateId ? safeId(root.templateId, "") || null : null,
    ingredients: normalizeRecipeMap(root.ingredients),
  };
}

export function validateBurgerStudioRecipe(
  config: BurgerStudioConfig,
  recipe: BurgerStudioRecipe,
) {
  const ingredientMap = new Map(config.ingredients.map((item) => [item.id, item]));
  const template = recipe.templateId
    ? config.templates.find((item) => item.id === recipe.templateId && item.active)
    : null;

  if (recipe.templateId && !template) {
    return { ok: false as const, error: "BURGER_STUDIO_TEMPLATE_INVALID" };
  }
  if (!recipe.templateId && !config.scratchEnabled) {
    return { ok: false as const, error: "BURGER_STUDIO_SCRATCH_DISABLED" };
  }

  let total = 0;
  for (const [id, qty] of Object.entries(recipe.ingredients)) {
    const ingredient = ingredientMap.get(id);
    if (!ingredient || !ingredient.active) {
      return {
        ok: false as const,
        error: "BURGER_STUDIO_INGREDIENT_INVALID",
        ingredientId: id,
      };
    }
    if (qty < 0 || qty > ingredient.max) {
      return {
        ok: false as const,
        error: "BURGER_STUDIO_INGREDIENT_QTY_INVALID",
        ingredientId: id,
      };
    }
    total += qty;
  }
  if (total > config.maxIngredients) {
    return { ok: false as const, error: "BURGER_STUDIO_TOO_MANY_INGREDIENTS" };
  }
  return { ok: true as const, template };
}

export function calculateBurgerStudioQuote(params: {
  config: BurgerStudioConfig;
  recipe: BurgerStudioRecipe;
  templateBasePrice?: number;
}): BurgerStudioQuote {
  const { config, recipe } = params;
  const validation = validateBurgerStudioRecipe(config, recipe);
  if (!validation.ok) throw new Error(validation.error);

  const ingredientMap = new Map(config.ingredients.map((item) => [item.id, item]));
  const baseRecipe = validation.template?.recipe ?? {};
  const basePrice = validation.template
    ? money(params.templateBasePrice, 0)
    : config.scratchBasePrice;
  const ids = new Set([
    ...Object.keys(baseRecipe),
    ...Object.keys(recipe.ingredients),
  ]);
  const lines: BurgerStudioQuoteLine[] = [];
  const selected: BurgerStudioQuote["selected"] = [];
  const removed: BurgerStudioQuote["removed"] = [];
  let delta = 0;

  for (const id of ids) {
    const ingredient = ingredientMap.get(id);
    if (!ingredient) continue;
    const baseQty = Math.max(0, Math.round(finiteNumber(baseRecipe[id], 0)));
    const qty = Math.max(
      0,
      Math.round(finiteNumber(recipe.ingredients[id], 0)),
    );
    const deltaQty = qty - baseQty;
    let amount = 0;
    if (validation.template) {
      amount =
        deltaQty > 0
          ? deltaQty * ingredient.addPrice
          : deltaQty < 0
            ? -Math.abs(deltaQty) * ingredient.removeCredit
            : 0;
    } else {
      amount = qty * ingredient.addPrice;
    }
    delta += amount;
    lines.push({
      ingredient,
      qty,
      baseQty,
      deltaQty,
      amount: Math.round(amount * 100) / 100,
    });
    if (qty > 0) selected.push({ ingredient, qty });
    if (baseQty > qty) removed.push({ ingredient, qty: baseQty - qty });
  }

  delta = Math.round(delta * 100) / 100;
  return {
    basePrice,
    delta,
    total: Math.max(0, Math.round((basePrice + delta) * 100) / 100),
    selected,
    removed,
    lines,
  };
}

export function burgerStudioRecipeLabel(
  config: BurgerStudioConfig,
  recipe: BurgerStudioRecipe,
) {
  const quote = calculateBurgerStudioQuote({
    config,
    recipe,
    templateBasePrice: 0,
  });
  return quote.selected
    .map(
      ({ ingredient, qty }) =>
        `${ingredient.name}${qty > 1 ? ` ×${qty}` : ""}`,
    )
    .join(", ");
}
