import type {
  BurgerStudioConfig,
  BurgerStudioIngredient,
  BurgerStudioRecipe,
  BurgerStudioTemplate,
} from "@/lib/burger-studio";

export type BurgerStudioCartExtra = {
  id: string;
  sku: string;
  name: string;
  label: string;
  price: number;
};

export type BurgerStudioOrderPlan = {
  basePrice: number;
  delta: number;
  total: number;
  add: BurgerStudioCartExtra[];
  rm: string[];
  selected: Array<{ ingredient: BurgerStudioIngredient; qty: number }>;
  removed: Array<{ ingredient: BurgerStudioIngredient; qty: number }>;
  lines: Array<{
    ingredient: BurgerStudioIngredient;
    qty: number;
    baseQty: number;
    deltaQty: number;
    amount: number;
  }>;
};

function cents(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number * 100)) : 0;
}

function fromCents(value: number) {
  return Math.max(0, Math.round(value)) / 100;
}

export function planBurgerStudioTemplateOrder(params: {
  config: BurgerStudioConfig;
  template: BurgerStudioTemplate;
  recipe: BurgerStudioRecipe;
  templateBasePrice: number;
}): BurgerStudioOrderPlan {
  const { config, template, recipe } = params;
  const ingredientMap = new Map(config.ingredients.map((item) => [item.id, item]));
  const ids = new Set([
    ...Object.keys(template.recipe || {}),
    ...Object.keys(recipe.ingredients || {}),
  ]);

  const selected: BurgerStudioOrderPlan["selected"] = [];
  const removed: BurgerStudioOrderPlan["removed"] = [];
  const positive: Array<{ ingredient: BurgerStudioIngredient; qty: number }> = [];
  const lineMap = new Map<string, BurgerStudioOrderPlan["lines"][number]>();

  for (const id of ids) {
    const ingredient = ingredientMap.get(id);
    if (!ingredient || !ingredient.active) continue;
    const baseQty = Math.max(
      0,
      Math.min(
        ingredient.max,
        Math.round(Number(template.recipe?.[id]) || 0),
      ),
    );
    const qty = Math.max(
      0,
      Math.min(
        ingredient.max,
        Math.round(Number(recipe.ingredients?.[id]) || 0),
      ),
    );
    const deltaQty = qty - baseQty;

    lineMap.set(id, {
      ingredient,
      qty,
      baseQty,
      deltaQty,
      amount: 0,
    });
    if (qty > 0) selected.push({ ingredient, qty });
    if (deltaQty > 0) positive.push({ ingredient, qty: deltaQty });
    if (deltaQty < 0) {
      removed.push({ ingredient, qty: Math.abs(deltaQty) });
    }
  }

  const add: BurgerStudioCartExtra[] = [
    {
      id: "bstudio:marker",
      sku: "bstudio:marker",
      name: "🔥 EIGENE KREATION",
      label: "🔥 EIGENE KREATION",
      price: 0,
    },
  ];
  let deltaCents = 0;

  for (const addition of positive) {
    let amountForIngredient = 0;
    for (let unit = 0; unit < addition.qty; unit += 1) {
      const priceCents = cents(addition.ingredient.addPrice);
      const price = fromCents(priceCents);
      add.push({
        id: `bstudio:add:${addition.ingredient.id}`,
        sku: `bstudio:add:${addition.ingredient.id}`,
        name: addition.ingredient.name,
        label: addition.ingredient.name,
        price,
      });
      deltaCents += priceCents;
      amountForIngredient += price;
    }

    const line = lineMap.get(addition.ingredient.id);
    if (line) line.amount = Math.round(amountForIngredient * 100) / 100;
  }

  const rm = removed.map(({ ingredient, qty }) =>
    `${ingredient.name}${qty > 1 ? ` ×${qty}` : ""}`,
  );
  const basePriceCents = cents(params.templateBasePrice);

  return {
    basePrice: fromCents(basePriceCents),
    delta: fromCents(deltaCents),
    total: fromCents(basePriceCents + deltaCents),
    add,
    rm,
    selected,
    removed,
    lines: Array.from(lineMap.values()),
  };
}
