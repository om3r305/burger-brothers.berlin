// components/admin/VariantTable.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Toggle from "@/components/ui/Toggle";
import DateTimePicker from "@/components/ui/DateTimePicker";

export type Variant = {
  id: string;
  name: string;
  price: number;
  image?: string;
  // yeni alanlar:
  active?: boolean;          // varyant bazında aktif/pasif
  stock?: number | null;     // null/undefined = limitsiz, 0 = bitti → pasif
  promoPercent?: number | null; // sadece bu varyanta % indirim (opsiyonel)
  startAt?: string;          // ISO
  endAt?: string;            // ISO
};

export type VariantGroup = {
  id?: string;
  sku: string;
  name: string;
  description?: string;
  image?: string;
  variants: Variant[];
  category?: "drinks" | "extras" | "burger" | "vegan" | "sauces" | "hotdogs";
};

type Props = {
  groups: VariantGroup[];
  onChange: (next: VariantGroup[]) => void;
  storageKey: string; // "bb_drink_groups_v1" | "bb_extra_groups_v1"
};

const fmt = (n: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);

export default function VariantTable({ groups, onChange, storageKey }: Props) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return groups;
    return groups.filter(
      (g) =>
        (g.name + " " + g.sku + " " + (g.description || "") + " " + g.variants.map((v) => v.name).join(" "))
          .toLowerCase()
          .includes(t)
    );
  }, [groups, q]);

  // mutate helpers
  const write = (updater: (draft: VariantGroup[]) => VariantGroup[]) => {
    const next = updater(structuredClone(groups));
    onChange(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch {}
  };

  const updateVar = (gid: number, vid: number, patch: Partial<Variant>) =>
    write((draft) => {
      Object.assign(draft[gid].variants[vid], patch);
      // stok 0 ise otomatik pasif
      const st = draft[gid].variants[vid].stock;
      if (typeof st === "number" && st <= 0) draft[gid].variants[vid].active = false;
      return draft;
    });

  const delVar = (gid: number, vid: number) =>
    write((draft) => {
      draft[gid].variants.splice(vid, 1);
      return draft;
    });

  const addVar = (gid: number) =>
    write((draft) => {
      const id = crypto?.randomUUID?.() ?? String(Date.now());
      draft[gid].variants.push({ id, name: "Yeni Varyant", price: 0, active: true });
      return draft;
    });

  return (
    <div className="card">
      <div className="mb-3 flex items-center gap-2">
        <div className="font-medium">Varyantlar</div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Grup veya varyant ara…"
          className="ml-auto rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 text-sm outline-none"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="text-sm opacity-70">Kayıt yok.</div>
      ) : (
        <div className="space-y-6">
          {filtered.map((g, gi) => (
            <div key={g.sku || g.name} className="rounded-xl border border-stone-700/60 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <div className="text-base font-semibold">
                  {g.name} <span className="text-xs text-stone-400">({g.sku})</span>
                </div>
                {g.description ? <div className="text-xs text-stone-400">• {g.description}</div> : null}
              </div>

              <div className="overflow-auto rounded-lg border border-stone-800/60">
                <table className="min-w-[860px] w-full text-sm">
                  <thead className="sticky top-0 bg-stone-900/80 backdrop-blur">
                    <tr className="[&>th]:px-3 [&>th]:py-2 text-left">
                      <th style={{width: 160}}>Varyant</th>
                      <th style={{width: 110}}>Fiyat</th>
                      <th style={{width: 90}}>Aktif</th>
                      <th style={{width: 110}}>Stok</th>
                      <th style={{width: 120}}>Kamp. %</th>
                      <th style={{width: 160}}>Başlangıç</th>
                      <th style={{width: 160}}>Bitiş</th>
                      <th style={{width: 240}}>Görsel URL</th>
                      <th style={{width: 110}}>İşlem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.variants.map((v, vi) => {
                      const liveActive =
                        (v.active ?? true) &&
                        (v.stock == null || v.stock > 0);
                      return (
                        <tr key={v.id} className="border-t border-stone-800/60 align-middle">
                          <td className="px-3 py-2">
                            <input
                              value={v.name}
                              onChange={(e) => updateVar(gi, vi, { name: e.target.value })}
                              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-2 py-1 outline-none"
                            />
                            <div className="mt-1 text-xs text-stone-400">
                              {liveActive ? "Satışta" : "Pasif"} {v.stock != null ? `• Stok: ${v.stock}` : "• ∞"}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              step="0.01"
                              value={String(v.price)}
                              onChange={(e) => updateVar(gi, vi, { price: Number(e.target.value) || 0 })}
                              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-2 py-1 outline-none"
                            />
                            <div className="text-xs text-stone-400">{fmt(v.price)}</div>
                          </td>
                          <td className="px-3 py-2">
                            <Toggle
                              checked={!!(v.active ?? true)}
                              onChange={(next) => updateVar(gi, vi, { active: next })}
                              label="Aktif"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min={0}
                              value={v.stock ?? ""}
                              placeholder="∞"
                              onChange={(e) => {
                                const raw = e.target.value;
                                updateVar(gi, vi, { stock: raw === "" ? null : Math.max(0, Math.floor(Number(raw) || 0)) });
                              }}
                              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-2 py-1 outline-none"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={v.promoPercent ?? ""}
                              placeholder="örn. 10"
                              onChange={(e) => {
                                const val = e.target.value;
                                updateVar(gi, vi, { promoPercent: val === "" ? null : Math.min(100, Math.max(0, Number(val) || 0)) });
                              }}
                              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-2 py-1 outline-none"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <DateTimePicker
                              value={v.startAt}
                              onChange={(iso) => updateVar(gi, vi, { startAt: iso || undefined })}
                              placeholder="seçilmedi"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <DateTimePicker
                              value={v.endAt}
                              onChange={(iso) => updateVar(gi, vi, { endAt: iso || undefined })}
                              placeholder="seçilmedi"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              value={v.image || ""}
                              onChange={(e) => updateVar(gi, vi, { image: e.target.value || undefined })}
                              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-2 py-1 outline-none"
                              placeholder="/images/drinks/coke-033.jpg"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <button className="btn-ghost" onClick={() => addVar(gi)}>Kopya +</button>
                              <button className="btn-ghost" onClick={() => delVar(gi, vi)}>Löschen</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-3">
                <button className="card-cta" onClick={() => addVar(gi)}>Yeni Varyant Ekle</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
