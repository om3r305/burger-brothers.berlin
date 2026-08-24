import {
  calculateBurgerStudioQuote,
  type BurgerStudioIngredient,
  type BurgerStudioRecipe,
  type BurgerStudioTemplate,
} from "@/lib/burger-studio";
import {
  BURGER_STUDIO_SCRATCH_SKU,
  type BurgerStudioV2Config,
} from "@/lib/burger-studio-v2";
import {
  planBurgerStudioTemplateOrder,
  type BurgerStudioCartExtra,
  type BurgerStudioOrderPlan,
} from "@/lib/burger-studio-order-plan";

function cents(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number * 100)) : 0;
}

function fromCents(value: number) {
  return Math.max(0, Math.round(value)) / 100;
}

export type BurgerStudioV2Plan = BurgerStudioOrderPlan & {
  mode: "freestyle" | "template";
  canonicalSku: string;
};

export function planBurgerStudioFreestyleOrder(params: {
  config: BurgerStudioV2Config;
  recipe: BurgerStudioRecipe;
}): BurgerStudioV2Plan {
  const { config, recipe } = params;
  const quote = calculateBurgerStudioQuote({
    config: config as any,
    recipe,
  });
  const add: BurgerStudioCartExtra[] = [
    {
      id: "bstudio:marker",
      sku: "bstudio:marker",
      name: "🔥 EIGENE KREATION",
      label: "🔥 EIGENE KREATION",
      price: 0,
    },
  ];

  let extrasCents = 0;
  const lines: BurgerStudioOrderPlan["lines"] = [];

  for (const line of quote.lines) {
    if (line.qty <= 0) continue;
    const ingredient = line.ingredient as BurgerStudioIngredient;
    let amount = 0;

    for (let unit = 0; unit < line.qty; unit += 1) {
      const unitCents = cents(ingredient.addPrice);
      const price = fromCents(unitCents);
      add.push({
        id: `bstudio:add:${ingredient.id}`,
        sku: `bstudio:add:${ingredient.id}`,
        name: ingredient.name,
        label: ingredient.name,
        price,
      });
      extrasCents += unitCents;
      amount += price;
    }

    lines.push({
      ingredient,
      qty: line.qty,
      baseQty: 0,
      deltaQty: line.qty,
      amount: Math.round(amount * 100) / 100,
    });
  }

  const baseCents = cents(config.scratchBasePrice);
  return {
    mode: "freestyle",
    canonicalSku: BURGER_STUDIO_SCRATCH_SKU,
    basePrice: fromCents(baseCents),
    delta: fromCents(extrasCents),
    total: fromCents(baseCents + extrasCents),
    add,
    rm: [],
    selected: quote.selected,
    removed: [],
    lines,
  };
}

export function planBurgerStudioV2Order(params: {
  config: BurgerStudioV2Config;
  recipe: BurgerStudioRecipe;
  template?: BurgerStudioTemplate | null;
  templateBasePrice?: number;
  templateSku?: string;
}): BurgerStudioV2Plan {
  if (!params.recipe.templateId) {
    return planBurgerStudioFreestyleOrder({
      config: params.config,
      recipe: params.recipe,
    });
  }

  if (!params.template) {
    throw new Error("BURGER_STUDIO_TEMPLATE_INVALID");
  }

  const plan = planBurgerStudioTemplateOrder({
    config: params.config as any,
    template: params.template,
    recipe: params.recipe,
    templateBasePrice: Number(params.templateBasePrice) || 0,
  });

  return {
    ...plan,
    mode: "template",
    canonicalSku: String(params.templateSku || params.template.productRef || ""),
  };
}
