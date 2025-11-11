// app/admin/variants/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import VariantTable, { VariantGroup } from "@/components/admin/VariantTable";

const LS_DRINK_GROUPS = "bb_drink_groups_v1";
const LS_EXTRA_GROUPS = "bb_extra_groups_v1";

export default function AdminVariantsPage() {
  const [drinkGroups, setDrinkGroups] = useState<VariantGroup[]>([]);
  const [extraGroups, setExtraGroups] = useState<VariantGroup[]>([]);
  const [tab, setTab] = useState<"drinks" | "extras">("drinks");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_DRINK_GROUPS);
      const arr = raw ? (JSON.parse(raw) as VariantGroup[]) : [];
      setDrinkGroups(Array.isArray(arr) ? arr : []);
    } catch { setDrinkGroups([]); }

    try {
      const raw = localStorage.getItem(LS_EXTRA_GROUPS);
      const arr = raw ? (JSON.parse(raw) as VariantGroup[]) : [];
      setExtraGroups(Array.isArray(arr) ? arr : []);
    } catch { setExtraGroups([]); }
  }, []);

  return (
    <main className="mx-auto max-w-7xl p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold">Varyant Yöneticisi</h1>
          <Link href="/admin" className="text-sm text-stone-300 hover:text-stone-100">← Admin</Link>
        </div>
        <div className="flex gap-2">
          <button className={`nav-pill ${tab === "drinks" ? "nav-pill--active" : ""}`} onClick={() => setTab("drinks")}>
            İçecek Grupları
          </button>
          <button className={`nav-pill ${tab === "extras" ? "nav-pill--active" : ""}`} onClick={() => setTab("extras")}>
            Extras Grupları
          </button>
        </div>
      </div>

      {tab === "drinks" ? (
        <VariantTable
          groups={drinkGroups}
          onChange={setDrinkGroups}
          storageKey={LS_DRINK_GROUPS}
        />
      ) : (
        <VariantTable
          groups={extraGroups}
          onChange={setExtraGroups}
          storageKey={LS_EXTRA_GROUPS}
        />
      )}
    </main>
  );
}
