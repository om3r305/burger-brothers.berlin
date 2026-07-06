// app/admin/variants/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import VariantTable, { VariantGroup } from "@/components/admin/VariantTable";

type TabKey = "drinks" | "extras";

type GroupsPayload = {
  ok?: boolean;
  drinkGroups?: VariantGroup[];
  extraGroups?: VariantGroup[];
  drinks?: VariantGroup[];
  extras?: VariantGroup[];
  groups?: {
    drinkGroups?: VariantGroup[];
    extraGroups?: VariantGroup[];
    drinks?: VariantGroup[];
    extras?: VariantGroup[];
  };
  data?: {
    drinkGroups?: VariantGroup[];
    extraGroups?: VariantGroup[];
    drinks?: VariantGroup[];
    extras?: VariantGroup[];
    groups?: {
      drinkGroups?: VariantGroup[];
      extraGroups?: VariantGroup[];
      drinks?: VariantGroup[];
      extras?: VariantGroup[];
    };
  };
};

function asGroupArray(value: any): VariantGroup[] {
  return Array.isArray(value) ? (value as VariantGroup[]) : [];
}

function readDrinkGroups(payload: GroupsPayload): VariantGroup[] {
  return asGroupArray(
    payload?.drinkGroups ??
      payload?.drinks ??
      payload?.groups?.drinkGroups ??
      payload?.groups?.drinks ??
      payload?.data?.drinkGroups ??
      payload?.data?.drinks ??
      payload?.data?.groups?.drinkGroups ??
      payload?.data?.groups?.drinks ??
      []
  );
}

function readExtraGroups(payload: GroupsPayload): VariantGroup[] {
  return asGroupArray(
    payload?.extraGroups ??
      payload?.extras ??
      payload?.groups?.extraGroups ??
      payload?.groups?.extras ??
      payload?.data?.extraGroups ??
      payload?.data?.extras ??
      payload?.data?.groups?.extraGroups ??
      payload?.data?.groups?.extras ??
      []
  );
}

export default function AdminVariantsPage() {
  const [drinkGroups, setDrinkGroups] = useState<VariantGroup[]>([]);
  const [extraGroups, setExtraGroups] = useState<VariantGroup[]>([]);
  const [tab, setTab] = useState<TabKey>("drinks");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const activeGroups = useMemo(
    () => (tab === "drinks" ? drinkGroups : extraGroups),
    [tab, drinkGroups, extraGroups]
  );

  useEffect(() => {
    let alive = true;

    const loadGroups = async () => {
      setLoading(true);

      try {
        const res = await fetch("/api/groups", {
          method: "GET",
          cache: "no-store",
          headers: {
            accept: "application/json",
          },
        });

        if (!res.ok) {
          throw new Error(`GROUPS_GET_${res.status}`);
        }

        const payload = (await res.json().catch(() => ({}))) as GroupsPayload;

        if (!alive) return;

        setDrinkGroups(readDrinkGroups(payload));
        setExtraGroups(readExtraGroups(payload));
      } catch (error) {
        console.error("Gruppen konnten nicht geladen werden:", error);

        if (!alive) return;

        setDrinkGroups([]);
        setExtraGroups([]);
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    };

    void loadGroups();

    return () => {
      alive = false;
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);

    try {
      const payload =
        tab === "drinks"
          ? {
              drinkGroups,
            }
          : {
              extraGroups,
            };

      const res = await fetch("/api/groups", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`GROUPS_PUT_${res.status} ${text}`);
      }

      alert("Gruppen wurden gespeichert ✅");

      try {
        window.dispatchEvent(new CustomEvent("bb:groups-sync"));
        window.dispatchEvent(new CustomEvent("bb:refresh-catalog"));
      } catch {}
    } catch (error: any) {
      console.error("Gruppen konnten nicht gespeichert werden:", error);
      alert(`Speichern fehlgeschlagen: ${error?.message || "Unbekannter Fehler"}`);
    } finally {
      setSaving(false);
    }
  };

  const handleReload = async () => {
    setLoading(true);

    try {
      const res = await fetch("/api/groups", {
        method: "GET",
        cache: "no-store",
        headers: {
          accept: "application/json",
        },
      });

      if (!res.ok) {
        throw new Error(`GROUPS_GET_${res.status}`);
      }

      const payload = (await res.json().catch(() => ({}))) as GroupsPayload;

      setDrinkGroups(readDrinkGroups(payload));
      setExtraGroups(readExtraGroups(payload));
    } catch (error: any) {
      console.error("Gruppen konnten nicht neu geladen werden:", error);
      alert(`Neu laden fehlgeschlagen: ${error?.message || "Unbekannter Fehler"}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto max-w-7xl p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold">Varianten-Verwaltung</h1>
          <Link href="/admin" className="text-sm text-stone-300 hover:text-stone-100">
            ← Admin
          </Link>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`nav-pill ${tab === "drinks" ? "nav-pill--active" : ""}`}
            onClick={() => setTab("drinks")}
          >
            Getränke-Gruppen
          </button>

          <button
            type="button"
            className={`nav-pill ${tab === "extras" ? "nav-pill--active" : ""}`}
            onClick={() => setTab("extras")}
          >
            Extras-Gruppen
          </button>
        </div>
      </div>

      <div className="mb-4 rounded-xl border border-stone-700/60 bg-stone-900/50 p-3 text-sm text-stone-300">
        {tab === "drinks"
          ? "Hier verwaltest du Getränke-Gruppen und deren Varianten."
          : "Hier verwaltest du Extras-Gruppen und deren Varianten."}
      </div>

      {loading ? (
        <div className="rounded-xl border border-stone-700/60 bg-stone-900/60 p-4 text-sm text-stone-300">
          Gruppen werden geladen…
        </div>
      ) : (
        <VariantTable
          groups={activeGroups}
          onChange={tab === "drinks" ? setDrinkGroups : setExtraGroups}
        />
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-lg bg-amber-600 px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
          onClick={handleSave}
          disabled={loading || saving}
        >
          {saving ? "Speichern…" : "Speichern"}
        </button>

        <button
          type="button"
          className="btn-ghost"
          onClick={handleReload}
          disabled={loading || saving}
        >
          Neu laden
        </button>
      </div>
    </main>
  );
}