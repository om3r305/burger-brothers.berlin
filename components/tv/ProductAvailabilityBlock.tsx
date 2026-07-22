"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import type {
  ProductAvailabilityAction,
  ProductAvailabilityMap,
  TvProduct,
} from "@/types/tv";
import {
  getProductAvailabilityEntry,
  isProductClosedByEntry,
  isProductTemporarilyClosed,
  normalizeProductText,
  productAvailabilityKey,
  productCategoryLabel,
  productCloseLabel,
  TV_PRODUCT_CATEGORY_ORDER,
} from "@/lib/tv/domain";

export function ProductAvailabilityBlock({
  products,
  availability,
  nowMs,
  busyKey,
  error,
  onChange,
  onRefresh,
}: {
  products: TvProduct[];
  availability: ProductAvailabilityMap;
  nowMs: number;
  busyKey: string;
  error: string;
  onChange: (product: TvProduct, action: ProductAvailabilityAction) => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const stats = useMemo(() => {
    let adminPassive = 0;
    let tvClosed = 0;
    let todayClosed = 0;
    let manualClosed = 0;

    for (const product of products) {
      const entry = getProductAvailabilityEntry(product, availability);
      const closed = isProductClosedByEntry(entry, nowMs);

      if (product.active === false) adminPassive += 1;

      if (closed) {
        tvClosed += 1;
        if (entry?.mode === "today") todayClosed += 1;
        else manualClosed += 1;
      }
    }

    return {
      total: products.length,
      available: Math.max(0, products.length - adminPassive - tvClosed),
      closed: adminPassive + tvClosed,
      tvClosed,
      todayClosed,
      manualClosed,
      adminPassive,
    };
  }, [availability, nowMs, products]);

  const grouped = useMemo(() => {
    const q = normalizeProductText(search).toLowerCase();
    const map = new Map<string, TvProduct[]>();

    for (const product of products) {
      const name = normalizeProductText(product.name).toLowerCase();
      const category = normalizeProductText(product.category || "burger").toLowerCase();
      const sku = normalizeProductText(product.sku || product.code || product.id).toLowerCase();

      if (q && !name.includes(q) && !category.includes(q) && !sku.includes(q)) {
        continue;
      }

      const key = category || "burger";
      const arr = map.get(key) || [];
      arr.push(product);
      map.set(key, arr);
    }

    for (const arr of map.values()) {
      arr.sort((a, b) => normalizeProductText(a.name).localeCompare(normalizeProductText(b.name), "de"));
    }

    const keys = Array.from(map.keys()).sort((a, b) => {
      const ai = TV_PRODUCT_CATEGORY_ORDER.indexOf(a);
      const bi = TV_PRODUCT_CATEGORY_ORDER.indexOf(b);
      const ax = ai >= 0 ? ai : 999;
      const bx = bi >= 0 ? bi : 999;

      if (ax !== bx) return ax - bx;

      return a.localeCompare(b);
    });

    return keys.map((key) => ({
      key,
      label: productCategoryLabel(key),
      items: map.get(key) || [],
    }));
  }, [products, search]);

  const searchActive = normalizeProductText(search).length > 0;

  const toggleGroup = (key: string) => {
    setOpenGroups((current) => ({
      ...current,
      [key]: current[key] !== true,
    }));
  };

  const CountBox = ({ label, value }: { label: string; value: number }) => (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wide text-stone-400">{label}</div>
      <div className="mt-0.5 text-lg font-bold tabular-nums">{value}</div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs uppercase tracking-wider text-stone-300/70">Artikel</div>
        <div className="mt-1 text-xs text-stone-400">
          Admin-Aktiv bleibt unverändert. Änderungen hier werden in den DB-Settings gespeichert.
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <CountBox label="Gesamt" value={stats.total} />
        <CountBox label="Geschlossen" value={stats.closed} />
        <CountBox label="Heute" value={stats.todayClosed} />
        <CountBox label="Dauerhaft" value={stats.manualClosed + stats.adminPassive} />
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/20 p-2">
        <label className="mb-1 block text-[11px] uppercase tracking-wide text-stone-400">
          Suche
        </label>
        <input
          value={search}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setSearch(event.target.value)}
          placeholder="Artikel suchen, z. B. Big"
          className="w-full rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-sm text-stone-100 outline-none placeholder:text-stone-500 focus:border-emerald-400/60"
        />
        {searchActive && (
          <div className="mt-1 flex items-center justify-between text-[11px] text-stone-400">
            <span>{grouped.reduce((sum, group) => sum + group.items.length, 0)} Treffer</span>
            <button
              type="button"
              onClick={() => setSearch("")}
              className="rounded-full border border-white/10 px-2 py-0.5 hover:bg-white/10"
            >
              Suche löschen
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onRefresh()}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
        >
          Aktualisieren
        </button>

        <div className="text-xs text-stone-400">
          Verfügbar: <span className="font-semibold text-emerald-100">{stats.available}</span>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-400/40 bg-rose-500/15 p-2 text-xs text-rose-100">
          {error}
        </div>
      )}

      {grouped.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm text-stone-300">
          Keine Artikel gefunden.
        </div>
      ) : (
        grouped.map((group) => {
          const groupClosed = group.items.filter((product) => {
            const entry = getProductAvailabilityEntry(product, availability);
            return product.active === false || isProductClosedByEntry(entry, nowMs);
          }).length;
          const collapsed = !searchActive && openGroups[group.key] !== true;

          return (
            <div key={group.key} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
              <button
                type="button"
                onClick={() => toggleGroup(group.key)}
                className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-white/[0.04]"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{group.label}</span>
                  <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[11px] text-stone-300">
                    {group.items.length}
                  </span>
                  {groupClosed > 0 && (
                    <span className="rounded-full border border-rose-400/40 bg-rose-500/15 px-2 py-0.5 text-[11px] text-rose-100">
                      {groupClosed} geschlossen
                    </span>
                  )}
                </div>

                <span className="text-lg leading-none text-stone-300">
                  {collapsed ? "▸" : "▾"}
                </span>
              </button>

              {!collapsed && (
                <div className="space-y-2 border-t border-white/10 p-3 pt-2">
                  {group.items.map((product) => {
                    const key = productAvailabilityKey(product);
                    const entry = getProductAvailabilityEntry(product, availability);
                    const closed = isProductClosedByEntry(entry, nowMs);
                    const busy = busyKey === key;
                    const adminPassive = product.active === false;

                    return (
                      <div key={key || product.name} className="rounded-xl border border-white/10 bg-black/20 p-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-medium leading-tight">{product.name}</div>
                            <div className="mt-0.5 text-[11px] text-stone-400">
                              {adminPassive ? "Admin: passiv" : productCloseLabel(entry, nowMs)}
                            </div>
                          </div>

                          <span
                            className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                              adminPassive
                                ? "border-stone-500/60 bg-stone-500/20 text-stone-200"
                                : closed
                                  ? "border-rose-400/50 bg-rose-500/15 text-rose-100"
                                  : "border-emerald-400/50 bg-emerald-500/15 text-emerald-100"
                            }`}
                          >
                            {adminPassive ? "Passiv" : closed ? "Geschlossen" : "Verfügbar"}
                          </span>
                        </div>

                        <div className="mt-2 grid grid-cols-3 gap-1.5 text-[11px]">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => onChange(product, "open")}
                            className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-2 py-1 text-emerald-100 disabled:opacity-40"
                          >
                            Öffnen
                          </button>

                          <button
                            type="button"
                            disabled={busy || adminPassive}
                            onClick={() => onChange(product, "today")}
                            className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-2 py-1 text-amber-100 disabled:opacity-40"
                          >
                            Heute schließen
                          </button>

                          <button
                            type="button"
                            disabled={busy || adminPassive}
                            onClick={() => onChange(product, "manual")}
                            className="rounded-lg border border-rose-400/40 bg-rose-500/10 px-2 py-1 text-rose-100 disabled:opacity-40"
                          >
                            Dauerhaft schließen
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
