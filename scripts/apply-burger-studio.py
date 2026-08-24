from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, found {count}")
    return text.replace(old, new, 1)


# components/store.ts
path = "components/store.ts"
text = read(path)
text = replace_once(
    text,
    '  note?: string;\n  __unitIds?: string[]; // freebie için birim izleme\n',
    '  note?: string;\n  burgerStudio?: Record<string, any>;\n  __unitIds?: string[]; // freebie için birim izleme\n',
    "store CartItemFixed",
)
text = replace_once(
    text,
    '  qty?: number;\n  note?: string;\n};\n',
    '  qty?: number;\n  note?: string;\n  burgerStudio?: Record<string, any>;\n};\n',
    "store AddPayload",
)
text = replace_once(
    text,
    '    note: typeof value.note === "string" ? value.note : undefined,\n    __unitIds: Array.isArray(value.__unitIds)\n',
    '    note: typeof value.note === "string" ? value.note : undefined,\n    burgerStudio: isRecord(value.burgerStudio)\n      ? (value.burgerStudio as Record<string, any>)\n      : undefined,\n    __unitIds: Array.isArray(value.__unitIds)\n',
    "store normalizeCartItem",
)
text = replace_once(
    text,
    '  rm?: string[];\n  note?: string;\n}) {\n',
    '  rm?: string[];\n  note?: string;\n  burgerStudio?: Record<string, any>;\n}) {\n',
    "store keyOf type",
)
text = replace_once(
    text,
    '  const noteSig = String(p.note ?? "").trim().toLowerCase();\n  return `${cat}__${sku}__add:${addSig}__rm:${rmSig}__note:${noteSig}`;\n',
    '  const noteSig = String(p.note ?? "").trim().toLowerCase();\n  const burgerStudioSig = p.burgerStudio ? JSON.stringify(p.burgerStudio) : "";\n  return `${cat}__${sku}__add:${addSig}__rm:${rmSig}__note:${noteSig}__studio:${burgerStudioSig}`;\n',
    "store keyOf signature",
)
text = replace_once(
    text,
    '  addToCart: ({ category, item, add = [], rm = [], qty = 1, note }) => {\n',
    '  addToCart: ({ category, item, add = [], rm = [], qty = 1, note, burgerStudio }) => {\n',
    "store addToCart args",
)
text = replace_once(
    text,
    '    const incoming = { category, item, add, rm, note };\n',
    '    const incoming = { category, item, add, rm, note, burgerStudio };\n',
    "store incoming",
)
text = replace_once(
    text,
    '      (ci) => keyOf({ category: ci.category, item: ci.item, add: ci.add, rm: ci.rm, note: ci.note }) === sig\n',
    '      (ci) => keyOf({ category: ci.category, item: ci.item, add: ci.add, rm: ci.rm, note: ci.note, burgerStudio: ci.burgerStudio }) === sig\n',
    "store existing signature",
)
text = replace_once(
    text,
    '      qty: incQty,\n      note,\n      __unitIds: unitIds,\n',
    '      qty: incQty,\n      note,\n      burgerStudio,\n      __unitIds: unitIds,\n',
    "store new cart item",
)
write(path, text)


# app/checkout/page.tsx
path = "app/checkout/page.tsx"
text = read(path)
text = replace_once(
    text,
    '        rm: Array.isArray(cartItem.rm) ? cartItem.rm : undefined,\n',
    '        rm: Array.isArray(cartItem.rm) ? cartItem.rm : undefined,\n        burgerStudio: cartItem.burgerStudio,\n',
    "checkout burgerStudio payload",
)
write(path, text)


# app/admin/AdminShell.tsx
path = "app/admin/AdminShell.tsx"
text = read(path)
text = replace_once(
    text,
    '  { href: "/admin", label: "Produkte & Gruppen", icon: "🍔", match: (p) => p === "/admin" },\n',
    '  { href: "/admin", label: "Produkte & Gruppen", icon: "🍔", match: (p) => p === "/admin" },\n  { href: "/admin/burger-studio", label: "Burger Studio", icon: "🧪", match: (p) => p.startsWith("/admin/burger-studio") },\n',
    "admin nav",
)
write(path, text)


# components/NavBar.tsx
path = "components/NavBar.tsx"
text = read(path)
text = replace_once(
    text,
    'function readFeatureEnabled(key: "donuts" | "bubbleTea") {\n',
    '''function readFeatureEnabled(key: "donuts" | "bubbleTea") {\n''',
    "navbar feature helper anchor",
)
# Insert a dedicated reader after the existing helper.
anchor = '''function useFeatureFlags() {\n  const [donutsOn, setDonutsOn] = useState(true);\n  const [bubbleTeaOn, setBubbleTeaOn] = useState(true);\n'''
replacement = '''function readBurgerStudioEnabled() {\n  try {\n    const raw = localStorage.getItem(LS_SETTINGS);\n    if (!raw) return false;\n    const settings = JSON.parse(raw);\n    return settings?.menu?.burgerStudio?.enabled === true;\n  } catch {\n    return false;\n  }\n}\n\nfunction useFeatureFlags() {\n  const [donutsOn, setDonutsOn] = useState(true);\n  const [bubbleTeaOn, setBubbleTeaOn] = useState(true);\n  const [burgerStudioOn, setBurgerStudioOn] = useState(false);\n'''
text = replace_once(text, anchor, replacement, "navbar useFeatureFlags")
text = replace_once(
    text,
    '      setDonutsOn(readFeatureEnabled("donuts"));\n      setBubbleTeaOn(readFeatureEnabled("bubbleTea"));\n',
    '      setDonutsOn(readFeatureEnabled("donuts"));\n      setBubbleTeaOn(readFeatureEnabled("bubbleTea"));\n      setBurgerStudioOn(readBurgerStudioEnabled());\n',
    "navbar sync studio",
)
text = replace_once(
    text,
    '    donutsOn,\n    bubbleTeaOn,\n  };\n',
    '    donutsOn,\n    bubbleTeaOn,\n    burgerStudioOn,\n  };\n',
    "navbar flags return",
)
text = replace_once(
    text,
    '  const { donutsOn, bubbleTeaOn } = useFeatureFlags();\n',
    '  const { donutsOn, bubbleTeaOn, burgerStudioOn } = useFeatureFlags();\n',
    "navbar flags destructure",
)
text = replace_once(
    text,
    '    for (const href of PREFETCH_ROUTES) {\n',
    '    for (const href of [...PREFETCH_ROUTES, "/burger-studio"]) {\n',
    "navbar prefetch studio",
)
cart_anchor = '''          <button\n            type="button"\n            className="nav-pill nav-pill--cart bb-app-nav__cart"\n'''
studio_button = '''          {burgerStudioOn ? (\n            <button\n              type="button"\n              className={[\n                "nav-pill",\n                "bb-app-nav__tab",\n                pathname === "/burger-studio" ? "nav-pill--active" : "",\n              ]\n                .filter(Boolean)\n                .join(" ")}\n              aria-current={pathname === "/burger-studio" ? "page" : undefined}\n              onClick={() => {\n                const href = "/burger-studio";\n                if (!beginNavigation(href)) return;\n                router.push(href, { scroll: false });\n              }}\n            >\n              <span aria-hidden className="mr-1">🔥</span>\n              Burger Studio\n            </button>\n          ) : null}\n\n          <button\n            type="button"\n            className="nav-pill nav-pill--cart bb-app-nav__cart"\n'''
text = replace_once(text, cart_anchor, studio_button, "navbar studio button")
write(path, text)


# lib/server/order-pricing.ts
path = "lib/server/order-pricing.ts"
text = read(path)
text = replace_once(
    text,
    'import { findEligibleRouteDealForCustomer } from "@/lib/server/route-deal-eligibility";\n',
    'import { findEligibleRouteDealForCustomer } from "@/lib/server/route-deal-eligibility";\nimport {\n  calculateBurgerStudioQuote,\n  normalizeBurgerStudioConfig,\n  normalizeBurgerStudioRecipe,\n  validateBurgerStudioRecipe,\n} from "@/lib/burger-studio";\n',
    "pricing studio imports",
)
text = replace_once(
    text,
    '  canonicalSource: CanonicalCatalogItem["source"];\n};\n',
    '  canonicalSource: CanonicalCatalogItem["source"] | "burger_studio";\n  burgerStudio?: Record<string, any>;\n};\n',
    "pricing canonical type",
)
helper_anchor = '''function canonicalizeItems(params: {\n'''
helper = '''function resolveBurgerStudioTemplateProduct(\n  productRef: string,\n  catalog: CanonicalCatalogItem[],\n) {\n  const target = normalizeKey(productRef);\n  const matches = catalog.filter(\n    (entry) => entry.source === "product" && entry.aliases.includes(target),\n  );\n\n  if (matches.length !== 1) {\n    throw new OrderPricingError(\n      "BURGER_STUDIO_TEMPLATE_PRODUCT_NOT_FOUND",\n      "Die gewählte Burger-Studio-Vorlage ist nicht mehr mit einem eindeutigen Menüprodukt verknüpft.",\n      409,\n      { productRef },\n    );\n  }\n\n  return matches[0];\n}\n\nfunction canonicalizeItems(params: {\n'''
text = replace_once(text, helper_anchor, helper, "pricing helper")
branch_anchor = '''    const catalogItem = resolveCatalogItem(rawItem, params.catalog);\n'''
branch = '''    const studioPayload = ensureObj(rawItem?.burgerStudio);\n    if (Object.keys(studioPayload).length > 0) {\n      const studioConfig = normalizeBurgerStudioConfig(\n        ensureObj(params.settings?.menu)?.burgerStudio,\n      );\n\n      if (!studioConfig.enabled) {\n        throw new OrderPricingError(\n          "BURGER_STUDIO_DISABLED",\n          "Das Burger Studio ist aktuell geschlossen.",\n          409,\n        );\n      }\n\n      if (\n        (params.mode === "pickup" && !studioConfig.pickupEnabled) ||\n        (params.mode === "delivery" && !studioConfig.deliveryEnabled)\n      ) {\n        throw new OrderPricingError(\n          "BURGER_STUDIO_MODE_DISABLED",\n          `Das Burger Studio ist für ${params.mode === "pickup" ? "Abholung" : "Lieferung"} aktuell nicht verfügbar.`,\n          409,\n        );\n      }\n\n      const recipe = normalizeBurgerStudioRecipe(\n        studioPayload.recipe ?? studioPayload,\n      );\n      const validation = validateBurgerStudioRecipe(studioConfig, recipe);\n      if (!validation.ok) {\n        throw new OrderPricingError(\n          validation.error,\n          "Diese Burger-Studio-Kreation ist nicht mehr gültig. Bitte öffne den Builder erneut.",\n          409,\n          "ingredientId" in validation\n            ? { ingredientId: validation.ingredientId }\n            : undefined,\n        );\n      }\n\n      let templateBasePrice = 0;\n      if (validation.template) {\n        const templateProduct = resolveBurgerStudioTemplateProduct(\n          validation.template.productRef,\n          params.catalog,\n        );\n        if (\n          !isAvailable(templateProduct, params.now) ||\n          unavailableByRuntimeSetting(\n            templateProduct,\n            availability,\n            params.now,\n          )\n        ) {\n          throw new OrderPricingError(\n            "BURGER_STUDIO_TEMPLATE_PRODUCT_UNAVAILABLE",\n            `Die Basis ${validation.template.name} ist aktuell nicht verfügbar.`,\n            409,\n          );\n        }\n        templateBasePrice = fromCents(templateProduct.priceCents);\n      }\n\n      let quote;\n      try {\n        quote = calculateBurgerStudioQuote({\n          config: studioConfig,\n          recipe,\n          templateBasePrice,\n        });\n      } catch {\n        throw new OrderPricingError(\n          "BURGER_STUDIO_RECIPE_INVALID",\n          "Diese Burger-Studio-Kreation konnte nicht berechnet werden.",\n          409,\n        );\n      }\n\n      const creationName = String(\n        studioPayload.name || validation.template?.name || "Mein Burger",\n      )\n        .trim()\n        .slice(0, 80) || "Mein Burger";\n      const studioSku = `burger-studio:${recipe.templateId || "scratch"}`;\n      const studioCatalogItem: CanonicalCatalogItem = {\n        source: "product",\n        id: studioSku,\n        sku: studioSku,\n        name: `EIGENE KREATION – ${creationName}`,\n        category: "burger",\n        priceCents: toCents(quote.total),\n        taxRate: 7,\n        active: true,\n        activeFrom: null,\n        activeTo: null,\n        extras: [],\n        pfandType: "none",\n        pfandAmountCents: 0,\n        aliases: uniqueAliases([studioSku]),\n      };\n      const campaignResult = campaignPriceCents(\n        studioCatalogItem,\n        params.campaigns,\n        params.mode,\n        params.now,\n      );\n      const unitPriceCents = campaignResult.priceCents;\n      merchandiseCents += unitPriceCents * qty;\n\n      if (params.mode === "delivery") {\n        categorySurchargeCents +=\n          toCents(categorySurcharges?.burger ?? 0) * qty;\n      }\n\n      const selectedLines = quote.selected.map(({ ingredient, qty: ingredientQty }) => ({\n        id: ingredient.id,\n        sku: ingredient.id,\n        label: `${ingredient.name}${ingredientQty > 1 ? ` ×${ingredientQty}` : ""}`,\n        name: ingredient.name,\n        price: 0,\n      }));\n      const baseLine = validation.template\n        ? [{\n            id: "burger-studio-basis",\n            sku: "burger-studio-basis",\n            label: `BASIS: ${validation.template.name}`,\n            name: `BASIS: ${validation.template.name}`,\n            price: 0,\n          }]\n        : [{\n            id: "burger-studio-basis",\n            sku: "burger-studio-basis",\n            label: "BASIS: FREESTYLE",\n            name: "BASIS: FREESTYLE",\n            price: 0,\n          }];\n\n      const canonical: CanonicalOrderItem = {\n        id: studioSku,\n        sku: studioSku,\n        name: `🔥 EIGENE KREATION – ${creationName}`,\n        description: quote.selected\n          .map(({ ingredient, qty: ingredientQty }) =>\n            `${ingredient.name}${ingredientQty > 1 ? ` ×${ingredientQty}` : ""}`,\n          )\n          .join(", ")\n          .slice(0, 500),\n        category: "burger",\n        price: fromCents(unitPriceCents),\n        taxRate: 7,\n        qty,\n        add: [...baseLine, ...selectedLines],\n        rm: quote.removed.map(({ ingredient, qty: removedQty }) =>\n          `${ingredient.name}${removedQty > 1 ? ` ×${removedQty}` : ""}`,\n        ),\n        note: rawItem?.note ? String(rawItem.note).slice(0, 500) : undefined,\n        pfandType: "none",\n        pfandAmount: 0,\n        depositType: "none",\n        depositAmount: 0,\n        canonicalBasePrice: fromCents(unitPriceCents),\n        canonicalExtrasTotal: 0,\n        canonicalUnitPrice: fromCents(unitPriceCents),\n        canonicalSource: "burger_studio",\n        burgerStudio: {\n          version: 1,\n          name: creationName,\n          recipe,\n          basePrice: quote.basePrice,\n          delta: quote.delta,\n          preCampaignTotal: quote.total,\n          total: fromCents(unitPriceCents),\n        },\n      };\n\n      canonicalItems.push(canonical);\n      couponItems.push({\n        sku: studioSku,\n        name: canonical.name,\n        category: "burger",\n        qty,\n        unitPrice: fromCents(unitPriceCents),\n      });\n      return;\n    }\n\n    const catalogItem = resolveCatalogItem(rawItem, params.catalog);\n'''
text = replace_once(text, branch_anchor, branch, "pricing studio canonical branch")
write(path, text)

print("Burger Studio integration patch applied successfully.")
