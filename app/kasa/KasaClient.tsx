"use client";

import { Fragment, useEffect, useMemo, useState } from "react";

type GroupKey = "burger" | "vegetarian" | "extras" | "sauces" | "drinks" | "lunch";
type PricingKey = "burger" | "vegan" | "extras" | "sauces" | "drinks";
type Extra = { id?: string; sku?: string; name?: string; label?: string; price?: number | string; active?: boolean };
type Product = { id?: string; sku?: string; code?: string; name?: string; category?: string; categoryKey?: string; price?: number | string; active?: boolean; activeFrom?: string | null; activeTo?: string | null; extras?: Extra[]; extrasJson?: Extra[] };
type Variant = { id?: string; sku?: string; name?: string; label?: string; price?: number | string; active?: boolean };
type PGroup = { id?: string; sku?: string; name?: string; title?: string; active?: boolean; variants?: Variant[]; items?: Variant[]; options?: Variant[] };
type Modifier = { key: string; name: string; price: number };
type Side = { key: string; name: string; upgrade: number };
type Item = { key: string; name: string; category: GroupKey; price: number; extras: Modifier[]; sides?: Side[] };
type Line = { key: string; name: string; price: number; quantity: number; kind: "product" | "modifier" | "side"; parentKey?: string; parentName?: string };

const TABS: Array<[GroupKey, string]> = [
  ["burger", "Burger"],
  ["vegetarian", "Vegetarisch"],
  ["extras", "Extras"],
  ["sauces", "Soßen"],
  ["drinks", "Getränke"],
  ["lunch", "Mittagsmenü"],
];

const LUNCH = [
  ["all-american", "All American + Fries", 8.9],
  ["cheesy-cheese", "Cheesy Cheese + Fries", 9.5],
  ["beef-bacon", "Beef & Bacon + Fries", 9.8],
  ["farmers-market", "Farmer’s Market + Fries", 9.9],
  ["halloumi", "Halloumi + Fries", 9.9],
] as const;

const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });
const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/[€\s]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const norm = (v: unknown) => String(v ?? "").toLocaleLowerCase("de-DE").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim();
const clean = (v: unknown) => String(v ?? "").replace(/[\u0000-\u001F\u007F◇◆◊�]/g, "").replace(/\s+/g, " ").trim();

function current(p: Product) {
  if (p.active === false) return false;
  const now = Date.now();
  if (p.activeFrom && new Date(p.activeFrom).getTime() > now) return false;
  if (p.activeTo && new Date(p.activeTo).getTime() < now) return false;
  return true;
}

function cat(p: Product): GroupKey | null {
  const v = norm(`${p.category ?? ""} ${p.categoryKey ?? ""}`);
  if (/vegan|veget/.test(v)) return "vegetarian";
  if (/sauce|soss|soß/.test(v)) return "sauces";
  if (/drink|getrank|beverage/.test(v)) return "drinks";
  if (/extra|beilage|snack/.test(v)) return "extras";
  if (/burger/.test(v)) return "burger";
  return null;
}

function pricingKey(c: GroupKey): PricingKey | null {
  if (c === "vegetarian") return "vegan";
  if (c === "lunch") return null;
  return c as PricingKey;
}

function extrasFor(p: Product): Modifier[] {
  const src = Array.isArray(p.extras) ? p.extras : Array.isArray(p.extrasJson) ? p.extrasJson : [];
  const seen = new Set<string>();
  return src.flatMap((x, i) => {
    if (!x || x.active === false) return [];
    const name = clean(x.name ?? x.label);
    const price = num(x.price);
    const fp = `${norm(name)}:${price.toFixed(2)}`;
    if (!name || price <= 0 || seen.has(fp)) return [];
    seen.add(fp);
    return [{ key: String(x.id ?? x.sku ?? `${fp}:${i}`), name, price }];
  });
}

function variants(g: PGroup) {
  return Array.isArray(g.variants) ? g.variants : Array.isArray(g.items) ? g.items : Array.isArray(g.options) ? g.options : [];
}

function flatten(groups: PGroup[], category: "extras" | "drinks"): Item[] {
  const seen = new Set<string>();
  const out: Item[] = [];
  groups.forEach((g, gi) => {
    if (!g || g.active === false) return;
    variants(g).forEach((v, vi) => {
      if (!v || v.active === false) return;
      const name = clean(v.name ?? v.label);
      const price = num(v.price);
      const fp = `${norm(name)}:${price.toFixed(2)}`;
      if (!name || seen.has(fp)) return;
      seen.add(fp);
      out.push({ key: `${category}:${g.id ?? g.sku ?? gi}:${v.id ?? v.sku ?? vi}`, name, category, price, extras: [] });
    });
  });
  return out;
}

function lunchSides(groups: PGroup[]): Side[] {
  const g = groups.find(x => x && x.active !== false && (norm(`${x.name} ${x.title} ${x.sku}`).includes("fries") || variants(x).some(v => norm(v.name ?? v.label) === "fries")));
  if (!g) return [];
  const all = variants(g)
    .filter(v => v && v.active !== false)
    .map((v, i) => ({ key: String(v.id ?? v.sku ?? i), name: clean(v.name ?? v.label), price: num(v.price) }))
    .filter(v => v.name);
  const base = all.find(v => norm(v.name) === "fries");
  if (!base) return [];
  return all.map(v => ({ key: v.key, name: v.name, upgrade: Math.max(0, money(v.price - base.price)) }));
}

export default function KasaClient() {
  const [items, setItems] = useState<Item[]>([]);
  const [cart, setCart] = useState<Record<string, Line>>({});
  const [tab, setTab] = useState<GroupKey>("burger");
  const [selected, setSelected] = useState<string | null>(null);
  const [sides, setSides] = useState<Record<string, string>>({});
  const [lifa, setLifa] = useState(false);
  const [pricing, setPricing] = useState<{ discount: number; surcharges: Partial<Record<PricingKey, number>> }>({ discount: 0, surcharges: {} });
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = old; };
  }, []);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const [cr, gr, sr] = await Promise.all([
          fetch("/api/catalog", { cache: "no-store" }),
          fetch("/api/groups", { cache: "no-store" }),
          fetch("/api/settings", { cache: "no-store" }),
        ]);
        const c = await cr.json();
        const g = await gr.json();
        const s = await sr.json().catch(() => ({}));
        if (!cr.ok || c.ok === false || !gr.ok || g.ok === false) throw new Error("load_failed");

        const raw: Product[] = Array.isArray(c.products) ? c.products : Array.isArray(c.items) ? c.items : [];
        const main = raw.flatMap((p, i) => {
          if (!current(p) || norm(p.sku ?? p.code) === "bstudio-scratch-base" || norm(p.name).includes("burger studio")) return [];
          const category = cat(p);
          const name = clean(p.name);
          const price = num(p.price);
          if (!category || !name) return [];
          return [{
            key: `product:${p.id ?? p.sku ?? p.code ?? `${category}:${i}`}`,
            name,
            category,
            price,
            extras: category === "burger" || category === "vegetarian" ? extrasFor(p) : [],
          } as Item];
        });

        const dg: PGroup[] = Array.isArray(g.drinkGroups) ? g.drinkGroups : Array.isArray(g.drinks) ? g.drinks : Array.isArray(g.groups?.drinkGroups) ? g.groups.drinkGroups : [];
        const eg: PGroup[] = Array.isArray(g.extraGroups) ? g.extraGroups : Array.isArray(g.extras) ? g.extras : Array.isArray(g.groups?.extraGroups) ? g.groups.extraGroups : [];
        const e = flatten(eg, "extras");
        const d = flatten(dg, "drinks");
        const ls = lunchSides(eg);
        const lunch: Item[] = LUNCH.map(x => ({ key: `lunch:${x[0]}`, name: x[1], price: x[2], category: "lunch", extras: [], sides: ls }));
        const base = main.filter(x => ["burger", "vegetarian", "sauces"].includes(x.category));
        const merged = [
          ...base,
          ...(e.length ? e : main.filter(x => x.category === "extras")),
          ...(d.length ? d : main.filter(x => x.category === "drinks")),
          ...lunch,
        ];

        const ss = s?.settings && typeof s.settings === "object" ? s.settings : s?.data && typeof s.data === "object" ? s.data : s;
        const del = ss?.delivery ?? {};
        const discount = Math.min(Math.max(Number(del.discountRate ?? ss?.discount?.lifaRate ?? ss?.discounts?.lifaPercent ?? 0) || 0, 0), .95);
        const sourceSurcharges = del?.surcharges ?? ss?.surcharges ?? {};
        const surcharges: Partial<Record<PricingKey, number>> = {};
        (["burger", "vegan", "extras", "sauces", "drinks"] as PricingKey[]).forEach(k => {
          surcharges[k] = Number(sourceSurcharges?.[k] ?? 0) || 0;
        });
        if (!dead) {
          setItems(merged);
          setPricing({ discount, surcharges });
        }
      } catch (e) {
        console.error(e);
        if (!dead) setError("Die Produkte konnten nicht geladen werden.");
      } finally {
        if (!dead) setLoading(false);
      }
    })();
    return () => { dead = true; };
  }, []);

  const byKey = useMemo(() => new Map(items.map(x => [x.key, x])), [items]);
  const counts = useMemo(() => Object.fromEntries(TABS.map(([k]) => [k, items.filter(x => x.category === k).length])) as Record<GroupKey, number>, [items]);
  const shown = useMemo(() => items.filter(x => x.category === tab && (!norm(search) || norm(x.name).includes(norm(search)))), [items, search, tab]);
  const lines = useMemo(() => Object.values(cart).filter(x => x.quantity > 0), [cart]);
  const qty = lines.reduce((a, x) => a + x.quantity, 0);

  const subtotal = useMemo(
    () => money(lines.reduce((sum, line) => sum + line.price * line.quantity, 0)),
    [lines],
  );

  const surchargeTotal = useMemo(() => {
    if (!lifa) return 0;
    return money(lines.reduce((sum, line) => {
      if (line.kind !== "product") return sum;
      const product = byKey.get(line.key);
      if (!product) return sum;
      const key = pricingKey(product.category);
      if (!key) return sum;
      return sum + (Number(pricing.surcharges[key] ?? 0) * line.quantity);
    }, 0));
  }, [byKey, lifa, lines, pricing.surcharges]);

  const beforeDiscount = money(subtotal + surchargeTotal);
  const discountTotal = lifa ? money(beforeDiscount * pricing.discount) : 0;
  const total = money(beforeDiscount - discountTotal);

  function select(p: Item) {
    setSelected(p.key);
    setCart(c => c[p.key]?.quantity ? c : {
      ...c,
      [p.key]: { key: p.key, name: p.name, price: p.price, quantity: 1, kind: "product" },
    });
    if (p.category === "lunch" && p.sides?.length && !sides[p.key]) {
      const f = p.sides.find(x => norm(x.name) === "fries") ?? p.sides[0];
      setSides(s => ({ ...s, [p.key]: f.key }));
    }
  }

  function change(key: string, d: number) {
    setCart(c => {
      const l = c[key];
      if (!l) return c;
      const n = Math.max(0, l.quantity + d);
      const next = { ...c };
      if (!n) {
        delete next[key];
        if (l.kind === "product") {
          Object.entries(next).forEach(([k, v]) => { if (v.parentKey === key) delete next[k]; });
        }
      } else {
        next[key] = { ...l, quantity: n };
        const sk = `side:${key}`;
        if (l.kind === "product" && next[sk]) next[sk] = { ...next[sk], quantity: n };
      }
      return next;
    });
    if (cart[key]?.kind === "product" && cart[key].quantity <= 1 && d < 0) setSelected(null);
  }

  function addExtra(p: Item, x: Modifier) {
    const k = `modifier:${p.key}:${x.key}`;
    setCart(c => ({
      ...c,
      [k]: {
        key: k,
        name: x.name,
        price: x.price,
        quantity: (c[k]?.quantity ?? 0) + 1,
        kind: "modifier",
        parentKey: p.key,
        parentName: p.name,
      },
    }));
  }

  function chooseSide(p: Item, x: Side) {
    const k = `side:${p.key}`;
    setSides(s => ({ ...s, [p.key]: x.key }));
    setCart(c => {
      const n = { ...c };
      delete n[k];
      if (x.upgrade > 0) {
        n[k] = {
          key: k,
          name: `${x.name} statt Fries`,
          price: x.upgrade,
          quantity: c[p.key]?.quantity ?? 1,
          kind: "side",
          parentKey: p.key,
          parentName: p.name,
        };
      }
      return n;
    });
  }

  function clearAll() {
    setCart({});
    setSelected(null);
    setSides({});
    setLifa(false);
  }

  return (
    <div id="bb-kasa-page" className="kasa">
      <style jsx global>{`
        html:has(#bb-kasa-page), body:has(#bb-kasa-page) {
          background: #090909 !important;
          color-scheme: only dark !important;
        }
        body:has(#bb-kasa-page) > footer,
        body:has(#bb-kasa-page) .bb-mobile-footer-gap {
          display: none !important;
        }
        .kasa, .kasa * { box-sizing: border-box; }
        .kasa button, .kasa input { font: inherit; }
        .kasa button { -webkit-tap-highlight-color: transparent; }
      `}</style>

      <header>
        <div><p>BURGER BROTHERS</p><h1>Preiskasse</h1></div>
        <b>Schnellrechnung</b>
      </header>

      <div className="top">
        <input placeholder="Produkt suchen…" value={search} onChange={e => setSearch(e.target.value)} />
        <nav>
          {TABS.map(([k, l]) => (
            <button key={k} className={tab === k ? "on" : ""} onClick={() => { setTab(k); setSelected(null); setSearch(""); }}>
              <span>{l}</span><small>{counts[k]}</small>
            </button>
          ))}
        </nav>
      </div>

      <main>
        {loading ? (
          <div className="state">Produkte werden geladen…</div>
        ) : error ? (
          <div className="state">{error}</div>
        ) : (
          <div className="grid">
            {shown.map(p => {
              const q = cart[p.key]?.quantity ?? 0;
              const sel = selected === p.key;
              return (
                <Fragment key={p.key}>
                  <button className={`prod ${q ? "added" : ""} ${sel ? "sel" : ""}`} onClick={() => select(p)}>
                    {q > 0 && <i>{q}</i>}
                    <span>{p.name}</span>
                    <strong>{euro.format(p.price)}</strong>
                  </button>

                  {sel && (
                    <section className="panel">
                      <div className="panelhead">
                        <div>
                          <small>{p.category === "lunch" ? "MITTAGSMENÜ" : "AUSGEWÄHLTES PRODUKT"}</small>
                          <strong>{p.name}</strong>
                        </div>
                        <div className="step">
                          <button onClick={() => change(p.key, -1)}>−</button>
                          <b>{q}</b>
                          <button onClick={() => change(p.key, 1)}>+</button>
                        </div>
                      </div>

                      {(p.category === "burger" || p.category === "vegetarian") && (
                        <>
                          <h3>EXTRAS FÜR DIESEN BURGER</h3>
                          <div className="options">
                            {p.extras.map(x => {
                              const k = `modifier:${p.key}:${x.key}`;
                              const n = cart[k]?.quantity ?? 0;
                              return (
                                <button key={x.key} className={n ? "chosen" : ""} onClick={() => addExtra(p, x)}>
                                  {n > 0 && <i>{n}</i>}
                                  <span>+ {x.name}</span>
                                  <strong>{euro.format(x.price)}</strong>
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}

                      {p.category === "lunch" && (
                        <>
                          <h3>FRIES AUSWÄHLEN</h3>
                          <div className="options">
                            {(p.sides ?? []).map(x => (
                              <button key={x.key} className={sides[p.key] === x.key ? "chosen" : ""} onClick={() => chooseSide(p, x)}>
                                <span>{norm(x.name) === "fries" ? "Fries inklusive" : `${x.name} statt Fries`}</span>
                                <strong>{x.upgrade ? `+ ${euro.format(x.upgrade)}` : "inklusive"}</strong>
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </section>
                  )}
                </Fragment>
              );
            })}
          </div>
        )}

        <section className="cart">
          <div className="carthead">
            <div><small>RECHNUNG</small><b>{qty} Artikel</b></div>
            {lines.length > 0 && <button onClick={clearAll}>Leeren</button>}
          </div>

          {!lines.length ? (
            <p>Produkt antippen, um es zur Rechnung hinzuzufügen.</p>
          ) : (
            <>
              {lines.map(l => (
                <div className="line" key={l.key}>
                  <div>
                    <span>{l.kind === "product" ? l.name : `+ ${l.name}`}</span>
                    {l.parentName && <small>{l.parentName}</small>}
                    <strong>{euro.format(l.price * l.quantity)}</strong>
                  </div>
                  {l.kind !== "side" && (
                    <div className="step">
                      <button onClick={() => change(l.key, -1)}>−</button>
                      <b>{l.quantity}</b>
                      <button onClick={() => change(l.key, 1)}>+</button>
                    </div>
                  )}
                </div>
              ))}

              <label className={`global-lifa ${lifa ? "on" : ""}`}>
                <input type="checkbox" checked={lifa} onChange={e => setLifa(e.target.checked)} />
                <u>{lifa ? "✓" : ""}</u>
                <span>
                  <b>Lifa / Lieferung</b>
                  <small>Lieferaufschläge + {Math.round(pricing.discount * 100)}% Rabatt</small>
                </span>
              </label>

              {lifa && (
                <div className="summary">
                  <div><span>Warenwert</span><strong>{euro.format(subtotal)}</strong></div>
                  <div><span>Lieferaufschläge</span><strong>{euro.format(surchargeTotal)}</strong></div>
                  <div className="discount"><span>Rabatt</span><strong>−{euro.format(discountTotal)}</strong></div>
                  <div className="sum"><span>Gesamt</span><strong>{euro.format(total)}</strong></div>
                </div>
              )}
            </>
          )}
        </section>
      </main>

      <div className="bottom">
        <div><small>GESAMT</small><strong>{euro.format(total)}</strong></div>
        <button disabled={!lines.length} onClick={clearAll}>Neue Rechnung</button>
      </div>

      <style jsx>{`
        .kasa {
          position: fixed; inset: 0; z-index: 100000; display: flex; flex-direction: column;
          height: 100dvh; background: #090909; color: #f5f5f5; overflow: hidden;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .kasa > header {
          display: flex; justify-content: space-between; align-items: center;
          padding: calc(env(safe-area-inset-top) + 12px) 14px 10px; background: #111; border-bottom: 1px solid #242424;
        }
        .kasa > header p { margin: 0 0 3px; color: #888; font-size: 10px; font-weight: 900; letter-spacing: .16em; }
        .kasa > header h1 { margin: 0; font-size: 26px; line-height: 1; }
        .kasa > header > b { padding: 7px 10px; border: 1px solid #353535; border-radius: 999px; color: #aaa; background: #181818; font-size: 10px; }
        .top { z-index: 20; padding: 9px 10px; background: #090909; box-shadow: 0 8px 18px #0008; }
        .top > input { width: 100%; height: 42px; padding: 0 13px; border: 1px solid #2b2b2b; border-radius: 11px; background: #151515; color: #fff; font-size: 16px; outline: none; }
        .top nav { display: flex; gap: 5px; margin-top: 7px; overflow-x: auto; scrollbar-width: none; }
        .top nav::-webkit-scrollbar { display: none; }
        .top nav button { position: relative; flex: 0 0 auto; min-width: 88px; height: 54px; border: 1px solid #2d2d2d; border-radius: 11px; background: #151515; color: #aaa; font-weight: 950; }
        .top nav button.on { background: #f3f3f3; color: #090909; border-color: #f3f3f3; }
        .top nav span { font-size: 12px; font-weight: 950; }
        .top nav small { position: absolute; right: 4px; top: 3px; font-size: 7px; color: #777; }
        main { flex: 1; min-height: 0; overflow: auto; padding: 8px 10px 132px; }
        .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
        .prod { position: relative; display: flex; min-height: 76px; flex-direction: column; align-items: flex-start; justify-content: space-between; padding: 11px 10px; border: 1px solid #2b2b2b; border-radius: 12px; background: #171717; color: #f4f4f4; text-align: left; }
        .prod.sel { border-color: #eee; box-shadow: inset 0 0 0 1px #eee; }
        .prod > span { font-size: 13px; font-weight: 900; }
        .prod > strong { color: #bbb; font-size: 13px; }
        .prod > i, .options i { position: absolute; right: 7px; top: 7px; display: grid; width: 22px; height: 22px; place-items: center; border-radius: 50%; background: #fff; color: #111; font-size: 11px; font-style: normal; font-weight: 950; }
        .panel { grid-column: 1 / -1; padding: 10px; border: 1px solid #444; border-radius: 14px; background: #111; }
        .panelhead { display: flex; justify-content: space-between; align-items: center; padding-bottom: 9px; border-bottom: 1px solid #292929; }
        .panelhead > div:first-child { display: flex; flex-direction: column; }
        .panelhead small, h3 { color: #777; font-size: 9px; font-weight: 900; letter-spacing: .13em; }
        .panelhead strong { font-size: 13px; }
        .step { display: grid; grid-template-columns: 34px 30px 34px; align-items: center; border: 1px solid #3a3a3a; border-radius: 10px; overflow: hidden; background: #1d1d1d; }
        .step button { width: 34px; height: 34px; border: 0; background: transparent; color: #fff; font-size: 20px; }
        .step b { text-align: center; font-size: 12px; }
        h3 { margin: 10px 1px 7px; }
        .options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
        .options button { position: relative; display: flex; min-height: 58px; flex-direction: column; align-items: flex-start; justify-content: space-between; padding: 9px; border: 1px solid #303030; border-radius: 10px; background: #1a1a1a; color: #eee; text-align: left; }
        .options button.chosen { border-color: #aaa; background: #242424; }
        .options span, .options strong { font-size: 11px; }
        .state { display: grid; min-height: 180px; place-items: center; color: #888; }
        .cart { margin-top: 12px; border: 1px solid #292929; border-radius: 14px; overflow: hidden; background: #121212; }
        .carthead { display: flex; align-items: center; justify-content: space-between; padding: 9px 11px; border-bottom: 1px solid #252525; }
        .carthead > div { display: flex; flex-direction: column; }
        .carthead small { color: #777; font-size: 9px; font-weight: 900; letter-spacing: .14em; }
        .carthead b { font-size: 12px; }
        .carthead > button { padding: 7px 10px; border: 1px solid #3b3b3b; border-radius: 9px; background: #1d1d1d; color: #bbb; font-size: 11px; }
        .cart > p { padding: 20px 12px; color: #777; text-align: center; font-size: 12px; }
        .line { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 9px 10px; border-bottom: 1px solid #222; }
        .line > div:first-child { display: flex; min-width: 0; flex: 1; flex-direction: column; }
        .line span { font-size: 12px; font-weight: 800; }
        .line small { color: #666; font-size: 9px; }
        .line strong { color: #999; font-size: 11px; }
        .global-lifa { display: flex; align-items: center; gap: 10px; margin: 10px; padding: 11px; border: 1px solid #3b3b3b; border-radius: 12px; background: #181818; cursor: pointer; }
        .global-lifa.on { border-color: #e0bd5d; background: #211e15; }
        .global-lifa input { position: absolute; opacity: 0; pointer-events: none; }
        .global-lifa u { display: grid; width: 24px; height: 24px; flex: 0 0 24px; place-items: center; border: 1px solid #666; border-radius: 6px; text-decoration: none; font-weight: 950; }
        .global-lifa.on u { border-color: #e0bd5d; background: #e0bd5d; color: #111; }
        .global-lifa span { display: flex; flex: 1; flex-direction: column; gap: 2px; }
        .global-lifa span b { font-size: 13px; }
        .global-lifa span small { color: #8b8b8b; font-size: 9px; }
        .summary { padding: 4px 12px 12px; }
        .summary > div { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; font-size: 12px; }
        .summary .discount { color: #52d497; }
        .summary .sum { margin-top: 3px; padding-top: 8px; border-top: 1px solid #292929; color: #fff; font-size: 14px; font-weight: 900; }
        .bottom { position: absolute; z-index: 30; right: 0; bottom: 0; left: 0; display: grid; grid-template-columns: 1fr auto; gap: 10px; min-height: 94px; padding: 11px 10px calc(env(safe-area-inset-bottom) + 11px); border-top: 1px solid #2a2a2a; background: #0b0b0bfa; box-shadow: 0 -10px 26px #0007; }
        .bottom > div { display: flex; flex-direction: column; justify-content: center; }
        .bottom small { color: #858585; font-size: 10px; font-weight: 900; letter-spacing: .16em; }
        .bottom strong { font-size: clamp(30px, 10vw, 44px); line-height: 1; font-weight: 950; font-variant-numeric: tabular-nums; }
        .bottom > button { min-width: 124px; border: 0; border-radius: 13px; background: #f5f5f5; color: #050505; font-size: 11px; font-weight: 900; }
        .bottom > button:disabled { background: #252525; color: #666; }
        @media (min-width: 560px) {
          .kasa { left: 50%; right: auto; width: 560px; transform: translateX(-50%); border-left: 1px solid #282828; border-right: 1px solid #282828; }
        }
      `}</style>
    </div>
  );
}
