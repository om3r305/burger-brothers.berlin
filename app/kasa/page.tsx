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

type GroupKey = "burger" | "vegetarian" | "extras" | "sauces" | "drinks";

type Modifier = {
  key: string;
  name: string;
  price: number;
};

type RegisterProduct = {
  key: string;
  name: string;
  category: GroupKey;
  price: number;
  extras: Modifier[];
};

type CartLine = {
  key: string;
  name: string;
  price: number;
  quantity: number;
  kind: "product" | "modifier";
  parentKey?: string;
  parentName?: string;
};

type Tab = {
  key: GroupKey;
  label: string;
};

const TABS: Tab[] = [
  { key: "burger", label: "Burger" },
  { key: "vegetarian", label: "Vegetarian" },
  { key: "extras", label: "Ekstralar" },
  { key: "sauces", label: "Soslar" },
  { key: "drinks", label: "İçecekler" },
];

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
        key: `${category}:${String(group.id ?? group.sku ?? groupIndex)}:${String(
          variant.id ?? variant.sku ?? variantIndex,
        )}`,
        name,
        category,
        price,
        extras: [],
      });
    });
  });

  return result;
}

function isBurgerGroup(group: GroupKey) {
  return group === "burger" || group === "vegetarian";
}

function modifierCartKey(product: RegisterProduct, modifier: Modifier) {
  return `modifier:${product.key}:${modifier.key}`;
}

export default function MobileRegisterPage() {
  const [products, setProducts] = useState<RegisterProduct[]>([]);
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [activeGroup, setActiveGroup] = useState<GroupKey>("burger");
  const [selectedProductKey, setSelectedProductKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
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

        const merged = [
          ...mainProducts,
          ...(groupedExtras.length > 0 ? groupedExtras : fallbackExtras),
          ...(groupedDrinks.length > 0 ? groupedDrinks : fallbackDrinks),
        ];

        if (!cancelled) setProducts(merged);
      } catch (loadError) {
        console.error("Kasa data load failed", loadError);
        if (!cancelled) setError("Kasa ürünleri şu anda yüklenemedi. Sayfayı yenileyin.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadRegisterData();

    return () => {
      cancelled = true;
    };
  }, []);

  const productByKey = useMemo(
    () => new Map(products.map((product) => [product.key, product])),
    [products],
  );

  const countsByGroup = useMemo(() => {
    const counts: Record<GroupKey, number> = {
      burger: 0,
      vegetarian: 0,
      extras: 0,
      sauces: 0,
      drinks: 0,
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

  const selectedProduct = useMemo(
    () => (selectedProductKey ? productByKey.get(selectedProductKey) ?? null : null),
    [productByKey, selectedProductKey],
  );

  const cartItems = useMemo(
    () => Object.values(cart).filter((line) => line.quantity > 0),
    [cart],
  );

  const totalQuantity = useMemo(
    () => cartItems.reduce((sum, line) => sum + line.quantity, 0),
    [cartItems],
  );

  const total = useMemo(
    () => cartItems.reduce((sum, line) => sum + line.price * line.quantity, 0),
    [cartItems],
  );

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

  function selectBurger(product: RegisterProduct) {
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

  function changeQuantity(key: string, delta: number) {
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

    if (currentQuantity <= 1 && delta < 0) {
      setSelectedProductKey(null);
    }

    changeQuantity(product.key, delta);
  }

  function clearCart() {
    setCart({});
    setSelectedProductKey(null);
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
        body:has(#bb-kasa-page) footer {
          display: none !important;
        }

        .bb-register-page,
        .bb-register-page * {
          box-sizing: border-box;
        }

        .bb-register-page button,
        .bb-register-page input {
          font: inherit;
        }

        .bb-register-page button {
          -webkit-tap-highlight-color: transparent;
          touch-action: manipulation;
        }
      `}</style>

      <header className="bb-register-header">
        <div>
          <p className="bb-register-kicker">BURGER BROTHERS</p>
          <h1>Fiyat Kasası</h1>
        </div>
        <div className="bb-register-status">Hızlı hesap</div>
      </header>

      <div className="bb-register-search-wrap">
        <input
          aria-label="Ürün ara"
          className="bb-register-search"
          placeholder="Ürün ara…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <nav className="bb-register-tabs" aria-label="Ürün kategorileri">
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

      <main className="bb-register-content">
        {loading ? (
          <div className="bb-register-state">Ürünler yükleniyor…</div>
        ) : error ? (
          <div className="bb-register-state is-error">{error}</div>
        ) : filteredProducts.length === 0 ? (
          <div className="bb-register-state">Bu bölümde ürün bulunamadı.</div>
        ) : (
          <div className="bb-register-grid">
            {filteredProducts.map((product) => {
              const quantity = cart[product.key]?.quantity ?? 0;
              const selected = selectedProductKey === product.key && isBurgerGroup(activeGroup);

              return (
                <Fragment key={product.key}>
                  <button
                    type="button"
                    className={`bb-product-button${quantity ? " is-in-cart" : ""}${selected ? " is-selected" : ""}`}
                    onClick={() => {
                      if (isBurgerGroup(activeGroup)) selectBurger(product);
                      else addProduct(product);
                    }}
                  >
                    {quantity > 0 && <span className="bb-product-count">{quantity}</span>}
                    <span className="bb-product-name">{product.name}</span>
                    <strong>{euro.format(product.price)}</strong>
                  </button>

                  {selected && (
                    <section className="bb-modifier-panel" aria-label={`${product.name} ekstraları`}>
                      <div className="bb-modifier-head">
                        <div>
                          <span>SEÇİLİ BURGER</span>
                          <strong>{product.name}</strong>
                        </div>
                        <div className="bb-main-qty">
                          <button
                            type="button"
                            aria-label={`${product.name} azalt`}
                            onClick={() => changeSelectedProductQuantity(product, -1)}
                          >
                            −
                          </button>
                          <b>{quantity}</b>
                          <button
                            type="button"
                            aria-label={`${product.name} artır`}
                            onClick={() => changeSelectedProductQuantity(product, 1)}
                          >
                            +
                          </button>
                        </div>
                      </div>

                      <div className="bb-modifier-title">Bu burgerin ekstraları</div>

                      {product.extras.length === 0 ? (
                        <div className="bb-no-modifiers">Bu burger için ücretli ekstra tanımlı değil.</div>
                      ) : (
                        <div className="bb-modifier-grid">
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
                                {modifierQuantity > 0 && (
                                  <span className="bb-modifier-count">{modifierQuantity}</span>
                                )}
                                <span>+ {modifier.name}</span>
                                <strong>{euro.format(modifier.price)}</strong>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  )}
                </Fragment>
              );
            })}
          </div>
        )}

        <section className="bb-cart-panel" aria-label="Hesap">
          <div className="bb-cart-heading">
            <div>
              <span>HESAP</span>
              <strong>{totalQuantity} kalem</strong>
            </div>
            {cartItems.length > 0 && (
              <button type="button" onClick={clearCart}>
                Temizle
              </button>
            )}
          </div>

          {cartItems.length === 0 ? (
            <div className="bb-cart-empty">Ürüne dokun, hesaba eklensin.</div>
          ) : (
            <div className="bb-cart-lines">
              {cartItems.map((line) => (
                <div className={`bb-cart-line${line.kind === "modifier" ? " is-modifier" : ""}`} key={line.key}>
                  <div className="bb-cart-line-main">
                    <span>{line.kind === "modifier" ? `+ ${line.name}` : line.name}</span>
                    {line.parentName && <small>{line.parentName} ekstrası</small>}
                    <strong>{euro.format(line.price * line.quantity)}</strong>
                  </div>
                  <div className="bb-quantity-control" aria-label={`${line.name} adet`}>
                    <button type="button" onClick={() => changeQuantity(line.key, -1)}>
                      −
                    </button>
                    <span>{line.quantity}</span>
                    <button type="button" onClick={() => changeQuantity(line.key, 1)}>
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <div className="bb-register-bottom">
        <div className="bb-register-total">
          <span>TOPLAM</span>
          <strong>{euro.format(total)}</strong>
        </div>
        <button type="button" className="bb-new-order" onClick={clearCart} disabled={!cartItems.length}>
          Yeni Hesap
        </button>
      </div>

      <style jsx>{`
        .bb-register-page {
          position: fixed;
          inset: 0;
          z-index: 100000;
          display: flex;
          flex-direction: column;
          width: 100%;
          min-width: 0;
          height: 100dvh;
          color: #f7f7f7;
          background: #090909;
          overflow: hidden;
          overscroll-behavior: none;
        }

        .bb-register-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: calc(env(safe-area-inset-top) + 12px) 14px 10px;
          border-bottom: 1px solid #242424;
          background: #111;
        }

        .bb-register-kicker {
          margin: 0 0 3px;
          color: #8d8d8d;
          font-size: 10px;
          font-weight: 850;
          letter-spacing: 0.16em;
        }

        .bb-register-header h1 {
          margin: 0;
          font-size: clamp(20px, 6vw, 27px);
          line-height: 1;
          font-weight: 950;
          letter-spacing: -0.04em;
        }

        .bb-register-status {
          flex: 0 0 auto;
          padding: 7px 10px;
          border: 1px solid #353535;
          border-radius: 999px;
          color: #aaa;
          background: #181818;
          font-size: 10px;
          font-weight: 800;
          white-space: nowrap;
        }

        .bb-register-search-wrap {
          padding: 9px 10px 7px;
          background: #090909;
        }

        .bb-register-search {
          width: 100%;
          height: 42px;
          padding: 0 13px;
          border: 1px solid #2b2b2b;
          border-radius: 11px;
          outline: none;
          color: #fff;
          background: #151515;
          font-size: 16px;
          appearance: none;
        }

        .bb-register-search:focus {
          border-color: #6d6d6d;
          background: #181818;
        }

        .bb-register-tabs {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 5px;
          padding: 0 10px 9px;
          background: #090909;
        }

        .bb-register-tabs button {
          position: relative;
          min-width: 0;
          min-height: 45px;
          padding: 7px 3px;
          border: 1px solid #2d2d2d;
          border-radius: 10px;
          color: #aaa;
          background: #151515;
          font-weight: 850;
          cursor: pointer;
        }

        .bb-register-tabs button.is-active {
          border-color: #f3f3f3;
          color: #090909;
          background: #f3f3f3;
        }

        .bb-register-tabs span {
          display: block;
          overflow: hidden;
          font-size: clamp(9px, 2.7vw, 11px);
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .bb-register-tabs small {
          position: absolute;
          top: 3px;
          right: 4px;
          color: #727272;
          font-size: 7px;
          font-weight: 900;
        }

        .bb-register-content {
          flex: 1 1 auto;
          min-height: 0;
          overflow-y: auto;
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
          padding: 0 10px 122px;
        }

        .bb-register-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 7px;
          width: 100%;
        }

        .bb-product-button {
          position: relative;
          display: flex;
          min-width: 0;
          min-height: 76px;
          flex-direction: column;
          align-items: flex-start;
          justify-content: space-between;
          gap: 8px;
          padding: 11px 10px;
          border: 1px solid #2b2b2b;
          border-radius: 12px;
          color: #f3f3f3;
          background: #171717;
          text-align: left;
          cursor: pointer;
          user-select: none;
        }

        .bb-product-button:active {
          transform: scale(0.985);
          background: #222;
        }

        .bb-product-button.is-in-cart {
          border-color: #777;
        }

        .bb-product-button.is-selected {
          border-color: #f1f1f1;
          background: #222;
          box-shadow: inset 0 0 0 1px #f1f1f1;
        }

        .bb-product-name {
          display: -webkit-box;
          width: calc(100% - 22px);
          overflow: hidden;
          color: #f5f5f5;
          font-size: 13px;
          font-weight: 850;
          line-height: 1.15;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
        }

        .bb-product-button > strong {
          color: #bcbcbc;
          font-size: 13px;
          font-weight: 850;
          font-variant-numeric: tabular-nums;
        }

        .bb-product-count,
        .bb-modifier-count {
          position: absolute;
          top: 7px;
          right: 7px;
          display: grid;
          width: 22px;
          height: 22px;
          place-items: center;
          border-radius: 999px;
          color: #0b0b0b;
          background: #fff;
          font-size: 11px;
          font-weight: 950;
        }

        .bb-modifier-panel {
          grid-column: 1 / -1;
          margin: 1px 0 3px;
          padding: 10px;
          border: 1px solid #454545;
          border-radius: 14px;
          background: #111;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
        }

        .bb-modifier-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding-bottom: 9px;
          border-bottom: 1px solid #292929;
        }

        .bb-modifier-head > div:first-child {
          display: flex;
          min-width: 0;
          flex-direction: column;
          gap: 2px;
        }

        .bb-modifier-head span,
        .bb-modifier-title {
          color: #777;
          font-size: 9px;
          font-weight: 900;
          letter-spacing: 0.13em;
        }

        .bb-modifier-head strong {
          overflow: hidden;
          color: #fff;
          font-size: 13px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .bb-main-qty {
          display: grid;
          flex: 0 0 auto;
          grid-template-columns: 34px 30px 34px;
          align-items: center;
          overflow: hidden;
          border: 1px solid #3a3a3a;
          border-radius: 10px;
          background: #1d1d1d;
        }

        .bb-main-qty button {
          width: 34px;
          height: 34px;
          border: 0;
          color: #fff;
          background: transparent;
          font-size: 20px;
        }

        .bb-main-qty b {
          font-size: 12px;
          text-align: center;
          font-variant-numeric: tabular-nums;
        }

        .bb-modifier-title {
          padding: 10px 1px 7px;
        }

        .bb-modifier-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 6px;
        }

        .bb-modifier-grid button {
          position: relative;
          display: flex;
          min-width: 0;
          min-height: 58px;
          flex-direction: column;
          align-items: flex-start;
          justify-content: space-between;
          gap: 5px;
          padding: 9px;
          border: 1px solid #303030;
          border-radius: 10px;
          color: #efefef;
          background: #1a1a1a;
          text-align: left;
        }

        .bb-modifier-grid button.is-added {
          border-color: #a8a8a8;
          background: #242424;
        }

        .bb-modifier-grid button > span:not(.bb-modifier-count) {
          width: calc(100% - 20px);
          font-size: 11px;
          font-weight: 850;
          line-height: 1.15;
        }

        .bb-modifier-grid button > strong {
          color: #aaa;
          font-size: 11px;
          font-variant-numeric: tabular-nums;
        }

        .bb-no-modifiers {
          padding: 13px 4px 4px;
          color: #777;
          font-size: 11px;
        }

        .bb-register-state {
          display: grid;
          min-height: 180px;
          place-items: center;
          padding: 24px;
          color: #858585;
          font-size: 13px;
          text-align: center;
        }

        .bb-register-state.is-error {
          color: #ffb4b4;
        }

        .bb-cart-panel {
          margin-top: 12px;
          border: 1px solid #292929;
          border-radius: 14px;
          overflow: hidden;
          background: #121212;
        }

        .bb-cart-heading {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          min-height: 51px;
          padding: 9px 11px;
          border-bottom: 1px solid #252525;
        }

        .bb-cart-heading > div {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .bb-cart-heading span {
          color: #777;
          font-size: 9px;
          font-weight: 900;
          letter-spacing: 0.14em;
        }

        .bb-cart-heading strong {
          color: #e5e5e5;
          font-size: 12px;
        }

        .bb-cart-heading button {
          min-height: 32px;
          padding: 0 10px;
          border: 1px solid #3b3b3b;
          border-radius: 9px;
          color: #bdbdbd;
          background: #1d1d1d;
          font-size: 11px;
          font-weight: 800;
        }

        .bb-cart-empty {
          padding: 20px 12px;
          color: #777;
          font-size: 12px;
          text-align: center;
        }

        .bb-cart-lines {
          padding: 3px 10px;
        }

        .bb-cart-line {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 9px 0;
          border-bottom: 1px solid #222;
        }

        .bb-cart-line:last-child {
          border-bottom: 0;
        }

        .bb-cart-line.is-modifier {
          padding-left: 8px;
        }

        .bb-cart-line-main {
          display: flex;
          min-width: 0;
          flex: 1;
          flex-direction: column;
          gap: 2px;
        }

        .bb-cart-line-main span {
          overflow: hidden;
          color: #e8e8e8;
          font-size: 12px;
          font-weight: 800;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .bb-cart-line-main small {
          color: #666;
          font-size: 9px;
        }

        .bb-cart-line-main strong {
          color: #929292;
          font-size: 11px;
          font-variant-numeric: tabular-nums;
        }

        .bb-quantity-control {
          display: grid;
          flex: 0 0 auto;
          grid-template-columns: 34px 28px 34px;
          align-items: center;
          overflow: hidden;
          border: 1px solid #333;
          border-radius: 10px;
          background: #1a1a1a;
        }

        .bb-quantity-control button {
          width: 34px;
          height: 34px;
          border: 0;
          color: #fff;
          background: transparent;
          font-size: 20px;
          font-weight: 500;
        }

        .bb-quantity-control span {
          color: #ddd;
          font-size: 12px;
          font-weight: 900;
          text-align: center;
          font-variant-numeric: tabular-nums;
        }

        .bb-register-bottom {
          position: absolute;
          right: 0;
          bottom: 0;
          left: 0;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 9px;
          align-items: stretch;
          padding: 10px 10px calc(env(safe-area-inset-bottom) + 10px);
          border-top: 1px solid #2a2a2a;
          background: rgba(11, 11, 11, 0.97);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
        }

        .bb-register-total {
          display: flex;
          min-width: 0;
          flex-direction: column;
          justify-content: center;
          padding: 3px 4px;
        }

        .bb-register-total span {
          color: #858585;
          font-size: 9px;
          font-weight: 900;
          letter-spacing: 0.16em;
        }

        .bb-register-total strong {
          overflow: hidden;
          color: #fff;
          font-size: clamp(24px, 8vw, 34px);
          font-weight: 950;
          line-height: 1.05;
          letter-spacing: -0.04em;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }

        .bb-new-order {
          min-width: 105px;
          min-height: 54px;
          padding: 0 15px;
          border: 0;
          border-radius: 13px;
          color: #050505;
          background: #f5f5f5;
          font-size: 12px;
          font-weight: 900;
        }

        .bb-new-order:disabled {
          color: #666;
          background: #252525;
        }

        @media (max-width: 360px) {
          .bb-register-tabs {
            gap: 3px;
            padding-right: 6px;
            padding-left: 6px;
          }

          .bb-register-tabs button {
            padding-right: 1px;
            padding-left: 1px;
          }

          .bb-register-tabs span {
            font-size: 9px;
          }
        }

        @media (min-width: 560px) {
          .bb-register-page {
            left: 50%;
            right: auto;
            width: min(100%, 560px);
            transform: translateX(-50%);
            border-right: 1px solid #282828;
            border-left: 1px solid #282828;
            box-shadow: 0 0 80px rgba(0, 0, 0, 0.5);
          }

          :global(body) {
            background: #050505 !important;
          }
        }
      `}</style>
    </div>
  );
}
