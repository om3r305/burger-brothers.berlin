"use client";

import { Fragment, useEffect, useMemo, useState } from "react";

type CatalogExtra = {
  id?: string;
  sku?: string;
  name?: string;
  label?: string;
  price?: number | string;
  active?: boolean;
};

type CatalogProduct = {
  id?: string;
  sku?: string;
  code?: string;
  name?: string;
  category?: string;
  categoryKey?: string;
  price?: number | string;
  active?: boolean;
  activeFrom?: string | null;
  activeTo?: string | null;
  extras?: CatalogExtra[];
  extrasJson?: CatalogExtra[];
};

type CatalogResponse = {
  ok?: boolean;
  products?: CatalogProduct[];
  items?: CatalogProduct[];
  error?: string;
};

type GroupVariant = {
  id?: string;
  sku?: string;
  name?: string;
  label?: string;
  price?: number | string;
  active?: boolean;
};

type ProductGroup = {
  id?: string;
  sku?: string;
  name?: string;
  title?: string;
  active?: boolean;
  variants?: GroupVariant[];
  items?: GroupVariant[];
  options?: GroupVariant[];
};

type GroupsResponse = {
  ok?: boolean;
  drinkGroups?: ProductGroup[];
  extraGroups?: ProductGroup[];
  drinks?: ProductGroup[];
  extras?: ProductGroup[];
  groups?: {
    drinkGroups?: ProductGroup[];
    extraGroups?: ProductGroup[];
    drinks?: ProductGroup[];
    extras?: ProductGroup[];
  };
  error?: string;
};

type GroupKey = "burger" | "vegetarian" | "extras" | "sauces" | "drinks" | "lunch";

type Modifier = {
  key: string;
  name: string;
  price: number;
};

type SideOption = {
  key: string;
  name: string;
  upgrade: number;
};

type RegisterProduct = {
  key: string;
  name: string;
  category: GroupKey;
  price: number;
  extras: Modifier[];
  sides?: SideOption[];
};

type CartLine = {
  key: string;
  name: string;
  price: number;
  quantity: number;
  kind: "product" | "modifier" | "side";
  parentKey?: string;
  parentName?: string;
};

type Tab = {
  key: GroupKey;
  label: string;
};

const TABS: Tab[] = [
  { key: "burger", label: "Burger" },
  { key: "vegetarian", label: "Vegetarisch" },
  { key: "extras", label: "Extras" },
  { key: "sauces", label: "Soßen" },
  { key: "drinks", label: "Getränke" },
  { key: "lunch", label: "Mittagsmenü" },
];

const LUNCH_MENUS = [
  { id: "all-american", name: "All American + Fries", price: 8.9 },
  { id: "cheesy-cheese", name: "Cheesy Cheese + Fries", price: 9.5 },
  { id: "beef-bacon", name: "Beef & Bacon + Fries", price: 9.8 },
  { id: "farmers-market", name: "Farmer’s Market + Fries", price: 9.9 },
  { id: "halloumi", name: "Halloumi + Fries", price: 9.9 },
] as const;

const euro = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

function toPrice(value: number | string | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? "").replace(/[€\s]/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeText(value: string) {
  return value
    .toLocaleLowerCase("de-DE")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function cleanDisplayName(value: unknown) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[◇◆◊�]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function productIsCurrent(product: CatalogProduct) {
  if (product.active === false) return false;
  const now = Date.now();

  if (product.activeFrom) {
    const start = new Date(product.activeFrom).getTime();
    if (Number.isFinite(start) && start > now) return false;
  }

  if (product.activeTo) {
    const end = new Date(product.activeTo).getTime();
    if (Number.isFinite(end) && end < now) return false;
  }

  return true;
}

function resolveCatalogCategory(product: CatalogProduct): GroupKey | null {
  const value = normalizeText(`${product.category ?? ""} ${product.categoryKey ?? ""}`);

  if (/vegan|veget/.test(value)) return "vegetarian";
  if (/sauce|soss|soß/.test(value)) return "sauces";
  if (/drink|getrank|beverage/.test(value)) return "drinks";
  if (/extra|beilage|snack/.test(value)) return "extras";
  if (/burger/.test(value)) return "burger";
  return null;
}

function isBurgerStudioScratch(product: CatalogProduct) {
  const sku = normalizeText(String(product.sku ?? product.code ?? ""));
  const name = normalizeText(String(product.name ?? ""));
  return sku === "bstudio-scratch-base" || name.includes("burger studio");
}

function productExtras(product: CatalogProduct): Modifier[] {
  const source = Array.isArray(product.extras)
    ? product.extras
    : Array.isArray(product.extrasJson)
      ? product.extrasJson
      : [];

  const seen = new Set<string>();
  const result: Modifier[] = [];

  source.forEach((extra, index) => {
    if (!extra || extra.active === false) return;
    const name = cleanDisplayName(extra.name ?? extra.label);
    const price = toPrice(extra.price);
    if (!name || price <= 0) return;

    const fingerprint = `${normalizeText(name)}:${price.toFixed(2)}`;
    if (seen.has(fingerprint)) return;
    seen.add(fingerprint);

    result.push({
      key: String(extra.id ?? extra.sku ?? `${fingerprint}:${index}`),
      name,
      price,
    });
  });

  return result;
}

function catalogProduct(product: CatalogProduct, index: number): RegisterProduct | null {
  if (!productIsCurrent(product) || isBurgerStudioScratch(product)) return null;

  const category = resolveCatalogCategory(product);
  const name = cleanDisplayName(product.name);
  const price = toPrice(product.price);
  if (!category || !name || price < 0) return null;

  return {
    key: `product:${String(product.id ?? product.sku ?? product.code ?? `${category}:${name}:${index}`)}`,
    name,
    category,
    price,
    extras: category === "burger" || category === "vegetarian" ? productExtras(product) : [],
  };
}

function readGroupVariants(group: ProductGroup) {
  if (Array.isArray(group.variants)) return group.variants;
  if (Array.isArray(group.items)) return group.items;
  if (Array.isArray(group.options)) return group.options;
  return [];
}

function flattenGroups(groups: ProductGroup[], category: "extras" | "drinks") {
  const result: RegisterProduct[] = [];
  const seen = new Set<string>();

  groups.forEach((group, groupIndex) => {
    if (!group || group.active === false) return;

    readGroupVariants(group).forEach((variant, variantIndex) => {
      if (!variant || variant.active === false) return;
      const name = cleanDisplayName(variant.name ?? variant.label);
      const price = toPrice(variant.price);
      if (!name || price < 0) return;

      const fingerprint = `${normalizeText(name)}:${price.toFixed(2)}`;
      if (seen.has(fingerprint)) return;
      seen.add(fingerprint);

      result.push({
        key: `${category}:${String(group.id ?? group.sku ?? groupIndex)}:${String(variant.id ?? variant.sku ?? variantIndex)}`,
        name,
        category,
        price,
        extras: [],
      });
    });
  });

  return result;
}

function lunchSideOptions(extraGroups: ProductGroup[]): SideOption[] {
  const allGroups = extraGroups.filter((group) => group && group.active !== false);
  const friesGroup = allGroups.find((group) => {
    const groupName = normalizeText(`${group.name ?? ""} ${group.title ?? ""} ${group.sku ?? ""}`);
    const names = readGroupVariants(group).map((variant) => normalizeText(String(variant.name ?? variant.label ?? "")));
    return groupName.includes("fries") || names.some((name) => name === "fries");
  });

  if (!friesGroup) return [];

  const variants = readGroupVariants(friesGroup)
    .filter((variant) => variant && variant.active !== false)
    .map((variant, index) => ({
      key: String(variant.id ?? variant.sku ?? index),
      name: cleanDisplayName(variant.name ?? variant.label),
      price: toPrice(variant.price),
    }))
    .filter((variant) => variant.name && variant.price >= 0);

  const base = variants.find((variant) => normalizeText(variant.name) === "fries");
  if (!base) return [];

  return variants.map((variant) => ({
    key: variant.key,
    name: variant.name,
    upgrade: Math.max(0, Number((variant.price - base.price).toFixed(2))),
  }));
}

function buildLunchMenus(sides: SideOption[]): RegisterProduct[] {
  return LUNCH_MENUS.map((menu) => ({
    key: `lunch:${menu.id}`,
    name: menu.name,
    category: "lunch" as const,
    price: menu.price,
    extras: [],
    sides,
  }));
}

function isBurgerGroup(group: GroupKey) {
  return group === "burger" || group === "vegetarian";
}

function isSelectableGroup(group: GroupKey) {
  return isBurgerGroup(group) || group === "lunch";
}

function modifierCartKey(product: RegisterProduct, modifier: Modifier) {
  return `modifier:${product.key}:${modifier.key}`;
}

function sideCartKey(product: RegisterProduct) {
  return `side:${product.key}`;
}

export default function MobileRegisterPage() {
  const [products, setProducts] = useState<RegisterProduct[]>([]);
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [activeGroup, setActiveGroup] = useState<GroupKey>("burger");
  const [selectedProductKey, setSelectedProductKey] = useState<string | null>(null);
  const [selectedSides, setSelectedSides] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [lieferando, setLieferando] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = oldOverflow;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadRegisterData() {
      try {
        setLoading(true);
        setError("");

        const [catalogResponse, groupsResponse] = await Promise.all([
          fetch("/api/catalog", { cache: "no-store" }),
          fetch("/api/groups", { cache: "no-store" }),
        ]);

        const catalogData = (await catalogResponse.json().catch(() => ({}))) as CatalogResponse;
        const groupsData = (await groupsResponse.json().catch(() => ({}))) as GroupsResponse;

        if (!catalogResponse.ok || catalogData.ok === false) {
          throw new Error(catalogData.error || "catalog_load_failed");
        }
        if (!groupsResponse.ok || groupsData.ok === false) {
          throw new Error(groupsData.error || "groups_load_failed");
        }

        const rawProducts = Array.isArray(catalogData.products)
          ? catalogData.products
          : Array.isArray(catalogData.items)
            ? catalogData.items
            : [];

        const catalogItems = rawProducts
          .map(catalogProduct)
          .filter((item): item is RegisterProduct => Boolean(item));

        const drinkGroups = Array.isArray(groupsData.drinkGroups)
          ? groupsData.drinkGroups
          : Array.isArray(groupsData.drinks)
            ? groupsData.drinks
            : Array.isArray(groupsData.groups?.drinkGroups)
              ? groupsData.groups!.drinkGroups!
              : [];

        const extraGroups = Array.isArray(groupsData.extraGroups)
          ? groupsData.extraGroups
          : Array.isArray(groupsData.extras)
            ? groupsData.extras
            : Array.isArray(groupsData.groups?.extraGroups)
              ? groupsData.groups!.extraGroups!
              : [];

        const groupedExtras = flattenGroups(extraGroups, "extras");
        const groupedDrinks = flattenGroups(drinkGroups, "drinks");
        const mainProducts = catalogItems.filter(
          (item) => item.category === "burger" || item.category === "vegetarian" || item.category === "sauces",
        );
        const fallbackExtras = catalogItems.filter((item) => item.category === "extras");
        const fallbackDrinks = catalogItems.filter((item) => item.category === "drinks");
        const lunchMenus = buildLunchMenus(lunchSideOptions(extraGroups));

        const merged = [
          ...mainProducts,
          ...(groupedExtras.length > 0 ? groupedExtras : fallbackExtras),
          ...(groupedDrinks.length > 0 ? groupedDrinks : fallbackDrinks),
          ...lunchMenus,
        ];

        if (!cancelled) setProducts(merged);
      } catch (loadError) {
        console.error("Preiskasse konnte nicht geladen werden", loadError);
        if (!cancelled) setError("Die Produkte konnten nicht geladen werden. Bitte die Seite neu laden.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadRegisterData();
    return () => {
      cancelled = true;
    };
  }, []);

  const countsByGroup = useMemo(() => {
    const counts: Record<GroupKey, number> = {
      burger: 0,
      vegetarian: 0,
      extras: 0,
      sauces: 0,
      drinks: 0,
      lunch: 0,
    };
    products.forEach((product) => {
      counts[product.category] += 1;
    });
    return counts;
  }, [products]);

  const filteredProducts = useMemo(() => {
    const query = normalizeText(search);
    return products.filter((product) => {
      if (product.category !== activeGroup) return false;
      return !query || normalizeText(product.name).includes(query);
    });
  }, [activeGroup, products, search]);

  const cartItems = useMemo(() => Object.values(cart).filter((line) => line.quantity > 0), [cart]);
  const totalQuantity = useMemo(() => cartItems.reduce((sum, line) => sum + line.quantity, 0), [cartItems]);
  const subtotal = useMemo(() => cartItems.reduce((sum, line) => sum + line.price * line.quantity, 0), [cartItems]);
  const lieferandoSurcharge = useMemo(
    () => (lieferando ? Number((subtotal * 0.1).toFixed(2)) : 0),
    [lieferando, subtotal],
  );
  const total = subtotal + lieferandoSurcharge;

  function addProduct(product: RegisterProduct) {
    setCart((current) => {
      const existing = current[product.key];
      return {
        ...current,
        [product.key]: {
          key: product.key,
          name: product.name,
          price: product.price,
          quantity: (existing?.quantity ?? 0) + 1,
          kind: "product",
        },
      };
    });
  }

  function selectProduct(product: RegisterProduct) {
    setSelectedProductKey(product.key);
    setCart((current) => {
      if (current[product.key]?.quantity) return current;
      return {
        ...current,
        [product.key]: {
          key: product.key,
          name: product.name,
          price: product.price,
          quantity: 1,
          kind: "product",
        },
      };
    });

    if (product.category === "lunch" && product.sides?.length && !selectedSides[product.key]) {
      const included = product.sides.find((side) => normalizeText(side.name) === "fries") ?? product.sides[0];
      setSelectedSides((current) => ({ ...current, [product.key]: included.key }));
    }
  }

  function addModifier(product: RegisterProduct, modifier: Modifier) {
    const key = modifierCartKey(product, modifier);
    setCart((current) => {
      const existing = current[key];
      return {
        ...current,
        [key]: {
          key,
          name: modifier.name,
          price: modifier.price,
          quantity: (existing?.quantity ?? 0) + 1,
          kind: "modifier",
          parentKey: product.key,
          parentName: product.name,
        },
      };
    });
  }

  function chooseLunchSide(product: RegisterProduct, side: SideOption) {
    const key = sideCartKey(product);
    setSelectedSides((current) => ({ ...current, [product.key]: side.key }));
    setCart((current) => {
      const next = { ...current };
      delete next[key];
      if (side.upgrade > 0) {
        next[key] = {
          key,
          name: `${side.name} statt Fries`,
          price: side.upgrade,
          quantity: current[product.key]?.quantity ?? 1,
          kind: "side",
          parentKey: product.key,
          parentName: product.name,
        };
      }
      return next;
    });
  }

  function changeQuantity(key: string, delta: number) {
    const currentLine = cart[key];
    if (currentLine?.kind === "product" && currentLine.quantity <= 1 && delta < 0) {
      setSelectedSides((current) => {
        if (!(key in current)) return current;
        const next = { ...current };
        delete next[key];
        return next;
      });
    }

    setCart((current) => {
      const line = current[key];
      if (!line) return current;
      const nextQuantity = Math.max(0, line.quantity + delta);
      const next = { ...current };

      if (nextQuantity === 0) {
        delete next[key];
        if (line.kind === "product") {
          Object.entries(next).forEach(([candidateKey, candidate]) => {
            if (candidate.parentKey === key) delete next[candidateKey];
          });
        }
      } else {
        next[key] = { ...line, quantity: nextQuantity };
        if (line.kind === "product") {
          const sideKey = `side:${key}`;
          if (next[sideKey]) next[sideKey] = { ...next[sideKey], quantity: nextQuantity };
        }
      }
      return next;
    });
  }

  function changeSelectedProductQuantity(product: RegisterProduct, delta: number) {
    const currentQuantity = cart[product.key]?.quantity ?? 0;
    if (currentQuantity === 0 && delta > 0) {
      addProduct(product);
      return;
    }
    if (currentQuantity <= 1 && delta < 0) setSelectedProductKey(null);
    changeQuantity(product.key, delta);
  }

  function clearCart() {
    setCart({});
    setSelectedProductKey(null);
    setSelectedSides({});
    setLieferando(false);
  }

  function switchGroup(group: GroupKey) {
    setActiveGroup(group);
    setSelectedProductKey(null);
    setSearch("");
  }

  return (
    <div id="bb-kasa-page" className="bb-register-page">
      <style jsx global>{`
        body:has(#bb-kasa-page) .bb-mobile-footer-gap,
        body:has(#bb-kasa-page) footer { display: none !important; }
        .bb-register-page, .bb-register-page * { box-sizing: border-box; }
        .bb-register-page button, .bb-register-page input { font: inherit; }
        .bb-register-page button { -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
      `}</style>

      <header className="bb-register-header">
        <div>
          <p>BURGER BROTHERS</p>
          <h1>Preiskasse</h1>
        </div>
        <div className="bb-status">Schnellrechnung</div>
      </header>

      <div className="bb-topbar">
        <div className="bb-search-wrap">
          <input
            aria-label="Produkt suchen"
            className="bb-search"
            placeholder="Produkt suchen…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <nav className="bb-tabs" aria-label="Produktkategorien">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={activeGroup === tab.key ? "is-active" : ""}
              onClick={() => switchGroup(tab.key)}
            >
              <span>{tab.label}</span>
              <small>{countsByGroup[tab.key]}</small>
            </button>
          ))}
        </nav>
      </div>

      <main className="bb-content">
        {loading ? (
          <div className="bb-state">Produkte werden geladen…</div>
        ) : error ? (
          <div className="bb-state is-error">{error}</div>
        ) : filteredProducts.length === 0 ? (
          <div className="bb-state">In dieser Kategorie wurden keine Produkte gefunden.</div>
        ) : (
          <div className="bb-grid">
            {filteredProducts.map((product) => {
              const quantity = cart[product.key]?.quantity ?? 0;
              const selected = selectedProductKey === product.key && isSelectableGroup(activeGroup);
              const sideSelection = selectedSides[product.key];

              return (
                <Fragment key={product.key}>
                  <button
                    type="button"
                    className={`bb-product${quantity ? " is-in-cart" : ""}${selected ? " is-selected" : ""}`}
                    onClick={() => {
                      if (isSelectableGroup(activeGroup)) selectProduct(product);
                      else addProduct(product);
                    }}
                  >
                    {quantity > 0 && <span className="bb-count">{quantity}</span>}
                    <span className="bb-product-name">{product.name}</span>
                    <strong>{euro.format(product.price)}</strong>
                  </button>

                  {selected && product.category !== "lunch" && (
                    <section className="bb-panel" aria-label={`Extras für ${product.name}`}>
                      <div className="bb-panel-head">
                        <div>
                          <span>GEWÄHLTER BURGER</span>
                          <strong>{product.name}</strong>
                        </div>
                        <div className="bb-main-qty" aria-label={`Anzahl ${product.name}`}>
                          <button type="button" aria-label="Weniger" onClick={() => changeSelectedProductQuantity(product, -1)}>−</button>
                          <b>{quantity}</b>
                          <button type="button" aria-label="Mehr" onClick={() => changeSelectedProductQuantity(product, 1)}>+</button>
                        </div>
                      </div>
                      <div className="bb-panel-title">EXTRAS FÜR DIESEN BURGER</div>
                      {product.extras.length === 0 ? (
                        <div className="bb-empty-extra">Für diesen Burger sind keine kostenpflichtigen Extras hinterlegt.</div>
                      ) : (
                        <div className="bb-options">
                          {product.extras.map((modifier) => {
                            const modifierKey = modifierCartKey(product, modifier);
                            const modifierQuantity = cart[modifierKey]?.quantity ?? 0;
                            return (
                              <button
                                key={modifier.key}
                                type="button"
                                className={modifierQuantity ? "is-added" : ""}
                                onClick={() => addModifier(product, modifier)}
                              >
                                {modifierQuantity > 0 && <span className="bb-option-count">{modifierQuantity}</span>}
                                <span>+ {modifier.name}</span>
                                <strong>{euro.format(modifier.price)}</strong>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  )}

                  {selected && product.category === "lunch" && (
                    <section className="bb-panel" aria-label={`Mittagsmenü ${product.name}`}>
                      <div className="bb-panel-head">
                        <div>
                          <span>MITTAGSMENÜ</span>
                          <strong>{product.name}</strong>
                        </div>
                        <div className="bb-main-qty" aria-label={`Anzahl ${product.name}`}>
                          <button type="button" aria-label="Weniger" onClick={() => changeSelectedProductQuantity(product, -1)}>−</button>
                          <b>{quantity}</b>
                          <button type="button" aria-label="Mehr" onClick={() => changeSelectedProductQuantity(product, 1)}>+</button>
                        </div>
                      </div>
                      <div className="bb-panel-title">FRIES AUSWÄHLEN</div>
                      <div className="bb-options bb-sides">
                        {(product.sides ?? []).map((side) => {
                          const active = sideSelection === side.key;
                          const label = normalizeText(side.name) === "fries"
                            ? "Fries inklusive"
                            : `${side.name} statt Fries`;
                          return (
                            <button
                              key={side.key}
                              type="button"
                              className={active ? "is-added" : ""}
                              onClick={() => chooseLunchSide(product, side)}
                            >
                              <span>{label}</span>
                              <strong>{side.upgrade > 0 ? `+ ${euro.format(side.upgrade)}` : "inklusive"}</strong>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  )}
                </Fragment>
              );
            })}
          </div>
        )}

        <section className="bb-cart" aria-label="Rechnung">
          <div className="bb-cart-head">
            <div><span>RECHNUNG</span><strong>{totalQuantity} Artikel</strong></div>
            {cartItems.length > 0 && <button type="button" onClick={clearCart}>Leeren</button>}
          </div>
          {cartItems.length === 0 ? (
            <div className="bb-cart-empty">Produkt antippen, um es zur Rechnung hinzuzufügen.</div>
          ) : (
            <div className="bb-cart-lines">
              {cartItems.map((line) => (
                <div className={`bb-cart-line${line.kind !== "product" ? " is-sub" : ""}`} key={line.key}>
                  <div className="bb-line-main">
                    <span>{line.kind === "product" ? line.name : `+ ${line.name}`}</span>
                    {line.parentName && <small>{line.parentName}</small>}
                    <strong>{euro.format(line.price * line.quantity)}</strong>
                  </div>
                  {line.kind !== "side" && (
                    <div className="bb-qty" aria-label={`Anzahl ${line.name}`}>
                      <button type="button" aria-label="Weniger" onClick={() => changeQuantity(line.key, -1)}>−</button>
                      <span>{line.quantity}</span>
                      <button type="button" aria-label="Mehr" onClick={() => changeQuantity(line.key, 1)}>+</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <div className="bb-bottom">
        <div className="bb-total">
          <span>GESAMT</span>
          <strong>{euro.format(total)}</strong>
          {lieferando && subtotal > 0 && (
            <small>Zwischensumme {euro.format(subtotal)} · Lieferando +10% ({euro.format(lieferandoSurcharge)})</small>
          )}
        </div>
        <div className="bb-bottom-actions">
          <button type="button" className="bb-new" onClick={clearCart} disabled={!cartItems.length}>Neue Rechnung</button>
          <label className={`bb-lieferando${lieferando ? " is-active" : ""}`}>
            <input
              type="checkbox"
              checked={lieferando}
              onChange={(event) => setLieferando(event.target.checked)}
            />
            <span className="bb-checkmark" aria-hidden="true">{lieferando ? "✓" : ""}</span>
            <span>Lieferando +10%</span>
          </label>
        </div>
      </div>

      <style jsx>{`
        .bb-register-page {
          position: fixed; inset: 0; z-index: 100000; display: flex; flex-direction: column;
          width: 100%; min-width: 0; height: 100dvh; color: #f7f7f7; background: #090909;
          overflow: hidden; overscroll-behavior: none; isolation: isolate;
        }
        .bb-register-header {
          position: relative; z-index: 80; flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 12px;
          padding: calc(env(safe-area-inset-top) + 12px) 14px 10px; border-bottom: 1px solid #242424; background: #111;
        }
        .bb-register-header p { margin: 0 0 3px; color: #8d8d8d; font-size: 10px; font-weight: 850; letter-spacing: .16em; }
        .bb-register-header h1 { margin: 0; font-size: clamp(20px, 6vw, 27px); line-height: 1; font-weight: 950; letter-spacing: -.04em; }
        .bb-status { padding: 7px 10px; border: 1px solid #353535; border-radius: 999px; color: #aaa; background: #181818; font-size: 10px; font-weight: 800; white-space: nowrap; }
        .bb-topbar {
          position: relative; z-index: 70; flex: 0 0 auto; background: #090909; box-shadow: 0 9px 18px rgba(0,0,0,.42);
        }
        .bb-search-wrap { padding: 9px 10px 7px; background: #090909; }
        .bb-search { width: 100%; height: 42px; padding: 0 13px; border: 1px solid #2b2b2b; border-radius: 11px; outline: none; color: #fff; background: #151515; font-size: 16px; appearance: none; }
        .bb-search:focus { border-color: #6d6d6d; background: #181818; }
        .bb-tabs {
          position: relative; z-index: 75; display: flex; gap: 5px; min-height: 54px; padding: 0 10px 9px; overflow-x: auto; overflow-y: hidden;
          background: #090909; scrollbar-width: none; -webkit-overflow-scrolling: touch; contain: paint;
        }
        .bb-tabs::-webkit-scrollbar { display: none; }
        .bb-tabs button {
          position: relative; z-index: 1; flex: 0 0 auto; min-width: 76px; min-height: 45px; padding: 7px 8px;
          border: 1px solid #2d2d2d; border-radius: 10px; color: #aaa; background: #151515; font-weight: 850;
        }
        .bb-tabs button.is-active { border-color: #f3f3f3; color: #090909; background: #f3f3f3; }
        .bb-tabs span { display: block; font-size: 10px; white-space: nowrap; }
        .bb-tabs small { position: absolute; top: 3px; right: 4px; color: #727272; font-size: 7px; font-weight: 900; }
        .bb-content {
          position: relative; z-index: 1; flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden;
          overscroll-behavior: contain; -webkit-overflow-scrolling: touch; padding: 8px 10px 174px; background: #090909;
        }
        .bb-grid { position: relative; z-index: 1; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; width: 100%; }
        .bb-product {
          position: relative; display: flex; min-width: 0; min-height: 76px; flex-direction: column; align-items: flex-start;
          justify-content: space-between; gap: 8px; padding: 11px 10px; border: 1px solid #2b2b2b; border-radius: 12px;
          color: #f3f3f3; background: #171717; text-align: left; user-select: none;
        }
        .bb-product:active { transform: scale(.985); background: #222; }
        .bb-product.is-in-cart { border-color: #777; }
        .bb-product.is-selected { border-color: #f1f1f1; background: #222; box-shadow: inset 0 0 0 1px #f1f1f1; }
        .bb-product-name { display: -webkit-box; width: calc(100% - 22px); overflow: hidden; color: #f5f5f5; font-size: 13px; font-weight: 850; line-height: 1.15; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
        .bb-product > strong { color: #bcbcbc; font-size: 13px; font-weight: 850; font-variant-numeric: tabular-nums; }
        .bb-count, .bb-option-count { position: absolute; top: 7px; right: 7px; display: grid; width: 22px; height: 22px; place-items: center; border-radius: 999px; color: #0b0b0b; background: #fff; font-size: 11px; font-weight: 950; }
        .bb-panel { grid-column: 1 / -1; margin: 1px 0 3px; padding: 10px; border: 1px solid #454545; border-radius: 14px; background: #111; box-shadow: 0 8px 24px rgba(0,0,0,.28); }
        .bb-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-bottom: 9px; border-bottom: 1px solid #292929; }
        .bb-panel-head > div:first-child { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
        .bb-panel-head span, .bb-panel-title { color: #777; font-size: 9px; font-weight: 900; letter-spacing: .13em; }
        .bb-panel-head strong { overflow: hidden; color: #fff; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
        .bb-main-qty { display: grid; flex: 0 0 auto; grid-template-columns: 34px 30px 34px; align-items: center; overflow: hidden; border: 1px solid #3a3a3a; border-radius: 10px; background: #1d1d1d; }
        .bb-main-qty button { width: 34px; height: 34px; border: 0; color: #fff; background: transparent; font-size: 20px; }
        .bb-main-qty b { font-size: 12px; text-align: center; font-variant-numeric: tabular-nums; }
        .bb-panel-title { padding: 10px 1px 7px; }
        .bb-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
        .bb-options button { position: relative; display: flex; min-width: 0; min-height: 58px; flex-direction: column; align-items: flex-start; justify-content: space-between; gap: 5px; padding: 9px; border: 1px solid #303030; border-radius: 10px; color: #efefef; background: #1a1a1a; text-align: left; }
        .bb-options button.is-added { border-color: #a8a8a8; background: #242424; box-shadow: inset 0 0 0 1px #7f7f7f; }
        .bb-options button > span:not(.bb-option-count) { width: calc(100% - 18px); font-size: 11px; font-weight: 850; line-height: 1.15; }
        .bb-options button > strong { color: #aaa; font-size: 11px; font-variant-numeric: tabular-nums; }
        .bb-sides button.is-added > strong { color: #fff; }
        .bb-empty-extra { padding: 13px 4px 4px; color: #777; font-size: 11px; }
        .bb-state { display: grid; min-height: 180px; place-items: center; padding: 24px; color: #858585; font-size: 13px; text-align: center; }
        .bb-state.is-error { color: #ffb4b4; }
        .bb-cart { margin-top: 12px; border: 1px solid #292929; border-radius: 14px; overflow: hidden; background: #121212; }
        .bb-cart-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 51px; padding: 9px 11px; border-bottom: 1px solid #252525; }
        .bb-cart-head > div { display: flex; flex-direction: column; gap: 2px; }
        .bb-cart-head span { color: #777; font-size: 9px; font-weight: 900; letter-spacing: .14em; }
        .bb-cart-head strong { color: #e5e5e5; font-size: 12px; }
        .bb-cart-head button { min-height: 32px; padding: 0 10px; border: 1px solid #3b3b3b; border-radius: 9px; color: #bdbdbd; background: #1d1d1d; font-size: 11px; font-weight: 800; }
        .bb-cart-empty { padding: 20px 12px; color: #777; font-size: 12px; text-align: center; }
        .bb-cart-lines { padding: 3px 10px; }
        .bb-cart-line { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 0; border-bottom: 1px solid #222; }
        .bb-cart-line:last-child { border-bottom: 0; }
        .bb-cart-line.is-sub { padding-left: 8px; }
        .bb-line-main { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 2px; }
        .bb-line-main span { overflow: hidden; color: #e8e8e8; font-size: 12px; font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }
        .bb-line-main small { color: #666; font-size: 9px; }
        .bb-line-main strong { color: #929292; font-size: 11px; font-variant-numeric: tabular-nums; }
        .bb-qty { display: grid; flex: 0 0 auto; grid-template-columns: 34px 28px 34px; align-items: center; overflow: hidden; border: 1px solid #333; border-radius: 10px; background: #1a1a1a; }
        .bb-qty button { width: 34px; height: 34px; border: 0; color: #fff; background: transparent; font-size: 20px; }
        .bb-qty span { color: #ddd; font-size: 12px; font-weight: 900; text-align: center; font-variant-numeric: tabular-nums; }
        .bb-bottom {
          position: absolute; z-index: 90; right: 0; bottom: 0; left: 0; display: grid; grid-template-columns: minmax(0,1fr) auto;
          gap: 10px; align-items: stretch; padding: 10px 10px calc(env(safe-area-inset-bottom) + 10px); border-top: 1px solid #2a2a2a;
          background: rgba(11,11,11,.98); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); box-shadow: 0 -12px 28px rgba(0,0,0,.35);
        }
        .bb-total { display: flex; min-width: 0; flex-direction: column; justify-content: center; padding: 3px 4px; }
        .bb-total > span { color: #858585; font-size: 9px; font-weight: 900; letter-spacing: .16em; }
        .bb-total > strong { overflow: hidden; color: #fff; font-size: clamp(24px,8vw,34px); font-weight: 950; line-height: 1.05; letter-spacing: -.04em; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .bb-total small { margin-top: 4px; max-width: 230px; color: #9a9a9a; font-size: 9px; line-height: 1.25; }
        .bb-bottom-actions { display: flex; min-width: 124px; flex-direction: column; gap: 7px; }
        .bb-new { min-width: 124px; min-height: 48px; padding: 0 13px; border: 0; border-radius: 13px; color: #050505; background: #f5f5f5; font-size: 11px; font-weight: 900; }
        .bb-new:disabled { color: #666; background: #252525; }
        .bb-lieferando {
          display: flex; min-height: 34px; align-items: center; justify-content: center; gap: 7px; padding: 5px 8px;
          border: 1px solid #353535; border-radius: 10px; color: #bdbdbd; background: #171717; font-size: 10px; font-weight: 850; cursor: pointer; user-select: none;
        }
        .bb-lieferando.is-active { border-color: #f5f5f5; color: #fff; background: #202020; }
        .bb-lieferando input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
        .bb-checkmark { display: grid; width: 17px; height: 17px; flex: 0 0 17px; place-items: center; border: 1px solid #666; border-radius: 5px; color: #050505; background: #0e0e0e; font-size: 12px; font-weight: 950; }
        .bb-lieferando.is-active .bb-checkmark { border-color: #fff; background: #fff; }
        @media (max-width: 360px) {
          .bb-bottom { gap: 6px; }
          .bb-bottom-actions, .bb-new { min-width: 112px; }
          .bb-total small { max-width: 190px; font-size: 8px; }
        }
        @media (min-width: 560px) {
          .bb-register-page { left: 50%; right: auto; width: min(100%,560px); transform: translateX(-50%); border-right: 1px solid #282828; border-left: 1px solid #282828; box-shadow: 0 0 80px rgba(0,0,0,.5); }
          :global(body) { background: #050505 !important; }
        }
      `}</style>
    </div>
  );
}
