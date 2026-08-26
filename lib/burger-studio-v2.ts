import {
  normalizeBurgerStudioConfig,
  normalizeBurgerStudioRecipe,
  type BurgerStudioConfig,
  type BurgerStudioIngredient,
  type BurgerStudioRecipe,
} from "@/lib/burger-studio";

export const BURGER_STUDIO_SCRATCH_SKU = "BSTUDIO-SCRATCH-BASE";
export const BURGER_STUDIO_SCRATCH_NAME = "Burger Studio – Freestyle Base";

export type BurgerStudioV2Config = Omit<BurgerStudioConfig, "version"> & {
  version: 2;
};

const V2_BUNS: BurgerStudioIngredient[] = [
  {
    id: "smash-brioche",
    name: "Smash Brioche Bun",
    group: "bun",
    addPrice: 0,
    removeCredit: 0,
    max: 1,
    active: true,
    vegan: false,
    visual: "bun-smash",
  },
  {
    id: "gluten-free-bun",
    name: "Glutenfreies Bun",
    group: "bun",
    addPrice: 0,
    removeCredit: 0,
    max: 1,
    active: true,
    vegan: false,
    visual: "bun-gluten-free",
  },
];

const APPETITE_PRO_INGREDIENTS: BurgerStudioIngredient[] = [
  {
    id: "black-angus",
    name: "Black Angus Patty",
    group: "protein",
    addPrice: 6,
    removeCredit: 0,
    max: 3,
    active: true,
    vegan: false,
    visual: "black-angus",
  },
  {
    id: "chicken-breast",
    name: "Chicken Breast",
    group: "protein",
    addPrice: 4.5,
    removeCredit: 0,
    max: 3,
    active: true,
    vegan: false,
    visual: "chicken-breast",
  },
  {
    id: "farmers-market",
    name: "Farmers Market Gemüse",
    group: "topping",
    addPrice: 3,
    removeCredit: 0,
    max: 2,
    active: true,
    vegan: true,
    visual: "farmers-market",
  },
];

function finiteNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function money(value: unknown, fallback = 0) {
  return Math.max(0, Math.round(finiteNumber(value, fallback) * 100) / 100);
}

function sourceObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function migrateIngredients(
  legacy: BurgerStudioIngredient[],
  sourceVersion: number,
): BurgerStudioIngredient[] {
  const map = new Map<string, BurgerStudioIngredient>();

  for (const ingredient of legacy) {
    const next = { ...ingredient };

    if (
      sourceVersion < 2 &&
      next.id === "brioche" &&
      next.name.trim().toLowerCase() === "brioche bun"
    ) {
      next.name = "Classic Bun";
      next.visual = "bun-classic";
    }

    if (
      sourceVersion < 2 &&
      next.id === "salat" &&
      next.name.trim().toLowerCase() === "salat"
    ) {
      next.name = "Grüner Salat";
      next.visual = "lettuce";
    }

    map.set(next.id, next);
  }

  if (sourceVersion < 2) {
    for (const bun of V2_BUNS) {
      if (!map.has(bun.id)) map.set(bun.id, { ...bun });
    }
  }

  // Additive live migration: production already stores a V2 Burger Studio config.
  // Missing premium ingredients are appended without touching existing prices,
  // active flags, quantities or templates. If an admin already created an item
  // with one of these ids, their saved version wins.
  for (const ingredient of APPETITE_PRO_INGREDIENTS) {
    if (!map.has(ingredient.id)) map.set(ingredient.id, { ...ingredient });
  }

  return Array.from(map.values());
}

export function normalizeBurgerStudioV2Config(
  value: unknown,
): BurgerStudioV2Config {
  const root = sourceObject(value);
  const sourceVersion = Math.max(1, Math.round(finiteNumber(root.version, 1)));
  const legacy = normalizeBurgerStudioConfig(value);

  return {
    ...legacy,
    version: 2,
    // v1 Admin intentionally forced scratchEnabled=false. For the first v2
    // migration we turn real Freestyle on; from then on Admin controls it.
    scratchEnabled:
      sourceVersion < 2 ? true : root.scratchEnabled !== false,
    scratchBasePrice: money(root.scratchBasePrice, legacy.scratchBasePrice),
    ingredients: migrateIngredients(legacy.ingredients, sourceVersion),
  };
}

export function createDefaultBurgerStudioV2Config(): BurgerStudioV2Config {
  return normalizeBurgerStudioV2Config(undefined);
}

export function normalizeBurgerStudioV2Recipe(
  value: unknown,
): BurgerStudioRecipe {
  return normalizeBurgerStudioRecipe(value);
}

export function burgerStudioRecipeCompletion(
  config: BurgerStudioV2Config,
  recipe: BurgerStudioRecipe,
) {
  const ingredientMap = new Map(config.ingredients.map((item) => [item.id, item]));
  let buns = 0;
  let proteins = 0;
  let total = 0;

  for (const [id, rawQty] of Object.entries(recipe.ingredients || {})) {
    const ingredient = ingredientMap.get(id);
    if (!ingredient || !ingredient.active) continue;
    const qty = Math.max(0, Math.min(ingredient.max, Math.round(Number(rawQty) || 0)));
    total += qty;
    if (ingredient.group === "bun") buns += qty;
    if (ingredient.group === "protein") proteins += qty;
  }

  return {
    bunCount: buns,
    proteinCount: proteins,
    totalIngredients: total,
    hasExactlyOneBun: buns === 1,
    hasProtein: proteins >= 1,
    withinLimit: total <= config.maxIngredients,
    complete: buns === 1 && proteins >= 1 && total <= config.maxIngredients,
  };
}

export function setExclusiveBurgerStudioBun(
  config: BurgerStudioV2Config,
  recipe: BurgerStudioRecipe,
  ingredientId: string,
  qty: number,
): BurgerStudioRecipe {
  const target = config.ingredients.find((item) => item.id === ingredientId);
  const ingredients = { ...recipe.ingredients };

  if (target?.group === "bun" && qty > 0) {
    for (const ingredient of config.ingredients) {
      if (ingredient.group === "bun") delete ingredients[ingredient.id];
    }
    ingredients[ingredientId] = 1;
    return { ...recipe, ingredients };
  }

  if (qty <= 0) delete ingredients[ingredientId];
  else ingredients[ingredientId] = qty;

  return { ...recipe, ingredients };
}
