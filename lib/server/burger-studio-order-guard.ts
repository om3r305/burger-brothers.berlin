import {
  BURGER_STUDIO_SCRATCH_SKU,
  burgerStudioRecipeCompletion,
  normalizeBurgerStudioV2Config,
} from "@/lib/burger-studio-v2";
import type { BurgerStudioRecipe } from "@/lib/burger-studio";

export type BurgerStudioGuardResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

function identity(value: any) {
  return String(value?.id ?? value?.sku ?? value?.code ?? "").trim();
}

export function validateBurgerStudioCanonicalSelection(params: {
  rawItem: any;
  catalogSku: string;
  resolvedExtras: any[];
  settings: any;
  mode: "pickup" | "delivery";
}): BurgerStudioGuardResult {
  const studioExtras = params.resolvedExtras.filter((extra) =>
    identity(extra).startsWith("bstudio:"),
  );
  const isScratch = params.catalogSku === BURGER_STUDIO_SCRATCH_SKU;

  if (!studioExtras.length && !isScratch) return { ok: true };

  const config = normalizeBurgerStudioV2Config(
    params.settings?.menu?.burgerStudio,
  );
  if (!config.enabled) {
    return {
      ok: false,
      code: "BURGER_STUDIO_DISABLED",
      message: "Burger Studio ist aktuell deaktiviert.",
    };
  }
  if (params.mode === "pickup" && !config.pickupEnabled) {
    return {
      ok: false,
      code: "BURGER_STUDIO_PICKUP_DISABLED",
      message: "Burger Studio ist für Abholung aktuell deaktiviert.",
    };
  }
  if (params.mode === "delivery" && !config.deliveryEnabled) {
    return {
      ok: false,
      code: "BURGER_STUDIO_DELIVERY_DISABLED",
      message: "Burger Studio ist für Lieferung aktuell deaktiviert.",
    };
  }

  const markerCount = studioExtras.filter(
    (extra) => identity(extra) === "bstudio:marker",
  ).length;
  if (markerCount !== 1) {
    return {
      ok: false,
      code: "BURGER_STUDIO_MARKER_INVALID",
      message: "Burger Studio Auswahl ist ungültig.",
    };
  }

  const ingredientMap = new Map(config.ingredients.map((item) => [item.id, item]));
  const counts = new Map<string, number>();
  for (const extra of studioExtras) {
    const id = identity(extra);
    if (!id.startsWith("bstudio:add:")) continue;
    const ingredientId = id.slice("bstudio:add:".length);
    const ingredient = ingredientMap.get(ingredientId);
    if (!ingredient || !ingredient.active) {
      return {
        ok: false,
        code: "BURGER_STUDIO_INGREDIENT_INVALID",
        message: "Eine Burger Studio Zutat ist nicht mehr verfügbar.",
      };
    }
    counts.set(ingredientId, (counts.get(ingredientId) || 0) + 1);
  }

  let total = 0;
  for (const [ingredientId, count] of counts) {
    const ingredient = ingredientMap.get(ingredientId)!;
    if (count > ingredient.max) {
      return {
        ok: false,
        code: "BURGER_STUDIO_INGREDIENT_QTY_INVALID",
        message: `${ingredient.name}: maximale Menge überschritten.`,
      };
    }
    total += count;
  }
  if (total > config.maxIngredients) {
    return {
      ok: false,
      code: "BURGER_STUDIO_TOO_MANY_INGREDIENTS",
      message: "Zu viele Zutaten im Burger Studio.",
    };
  }

  if (isScratch) {
    if (!config.scratchEnabled) {
      return {
        ok: false,
        code: "BURGER_STUDIO_FREESTYLE_DISABLED",
        message: "Freestyle ist aktuell deaktiviert.",
      };
    }

    const recipe: BurgerStudioRecipe = {
      version: 1,
      templateId: null,
      ingredients: Object.fromEntries(counts),
    };
    const completion = burgerStudioRecipeCompletion(config, recipe);
    if (!completion.hasExactlyOneBun) {
      return {
        ok: false,
        code: "BURGER_STUDIO_BUN_REQUIRED",
        message: "Freestyle benötigt genau ein Bun.",
      };
    }
    if (!completion.hasProtein) {
      return {
        ok: false,
        code: "BURGER_STUDIO_PROTEIN_REQUIRED",
        message: "Freestyle benötigt mindestens ein Protein.",
      };
    }
  }

  return { ok: true };
}
