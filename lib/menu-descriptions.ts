// Shared customer-visible recipe descriptions; keep the menu and Bros in sync.
export type CategoryKey = "burger" | "vegan" | "hotdogs";

export const BLURBS_DE: Record<CategoryKey, string> = {
  burger:
    "Jeder Burger wird mit Brötchen und Rinderhackfleisch aus der Region, Tomaten, Zwiebeln, Eisbergsalat und Gewürzgurken zubereitet und mit Ketchup oder Mayonnaise serviert. Allergene: Gluten, Milch, Senf, Sesam.",
  vegan:
    "Pflanzliche Patties, Tomaten, Zwiebeln, Salat, Gurken. Vegane Mayo/Ketchup. Allergene: Gluten, Soja, Senf.",
  hotdogs:
    "Rind-Wurst im Brötchen, Röstzwiebeln, Gurken-Relish, Ketchup/Senf. Allergene: Gluten, Senf, Sellerie.",
};

