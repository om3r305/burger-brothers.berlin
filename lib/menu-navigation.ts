export const MENU_NAV_ITEMS = [
  { key: "burger", label: "Burger", href: "/menu?cat=burger" },
  { key: "vegan", label: "Vegan / Vegetarisch", href: "/menu?cat=vegan" },
  { key: "extras", label: "Extras", href: "/extras" },
  { key: "sauces", label: "Soßen", href: "/sauces" },
  { key: "hotdogs", label: "Hot Dogs", href: "/hotdogs" },
  { key: "drinks", label: "Getränke", href: "/drinks" },
  { key: "donuts", label: "Donuts", href: "/donuts" },
  { key: "bubbletea", label: "Bubble Tea", href: "/bubble-tea" },
] as const;

export type MenuNavKey = (typeof MENU_NAV_ITEMS)[number]["key"];

export const MENU_NAV_KEYS = MENU_NAV_ITEMS.map((item) => item.key) as MenuNavKey[];

export const MENU_NAV_LABELS = Object.fromEntries(
  MENU_NAV_ITEMS.map((item) => [item.key, item.label]),
) as Record<MenuNavKey, string>;

export const MENU_NAV_ROUTES = Object.fromEntries(
  MENU_NAV_ITEMS.map((item) => [item.key, item.href]),
) as Record<MenuNavKey, string>;
