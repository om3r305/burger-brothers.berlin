// app/admin/freebies/page.tsx
"use client";

import { useEffect, useState } from "react";
import AdminSidebar from "@/components/admin/Sidebar";
import Toggle from "@/components/ui/Toggle";

const LS_SETTINGS = "bb_settings_v6";
const FREEBIE_TARGETS = ["sauces", "drinks"] as const;
type FreebieTarget = (typeof FREEBIE_TARGETS)[number];
type FreebieMode = "both" | "delivery" | "pickup";

type FreebieTier = {
  minTotal: number;
  freeSauces: number;
};

const FB_DEFAULT = {
  enabled: false,
  category: "sauces" as FreebieTarget,
  mode: "both" as FreebieMode,
  tiers: [] as FreebieTier[],
};

function safeSettings(raw: any) {
  return raw?.settings ?? raw?.data ?? raw ?? {};
}

function mirrorSettings(next: any) {
  try {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("bb_settings_changed", { detail: next }));
    window.dispatchEvent(new CustomEvent("bb:settings-sync", { detail: next }));
  } catch {}
}

function getFreebies(settings: any): typeof FB_DEFAULT {
  const fb = settings?.freebies ?? settings?.offers?.freebies ?? FB_DEFAULT;

  return {
    enabled: fb?.enabled === true,
    category: FREEBIE_TARGETS.includes(fb?.category) ? fb.category : "sauces",
    mode:
      fb?.mode === "delivery" || fb?.mode === "pickup" || fb?.mode === "both"
        ? fb.mode
        : "both",
    tiers: Array.isArray(fb?.tiers) ? fb.tiers : [],
  };
}

function getTierMinTotal(fb: typeof FB_DEFAULT) {
  return fb.tiers[0]?.minTotal ?? 0;
}

function getTierFreeCount(fb: typeof FB_DEFAULT) {
  return fb.tiers[0]?.freeSauces ?? 0;
}

export default function AdminFreebiesPage() {
  const [settings, setSettings] = useState<any>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const res = await fetch("/api/settings", {
          method: "GET",
          cache: "no-store",
          headers: { accept: "application/json" },
        });

        if (!res.ok) throw new Error(`SETTINGS_GET_${res.status}`);

        const json = await res.json().catch(() => ({}));
        const next = safeSettings(json);

        if (!alive) return;

        setSettings(next);
        mirrorSettings(next);
      } catch {
        try {
          const raw = localStorage.getItem(LS_SETTINGS);
          if (alive) setSettings(raw ? JSON.parse(raw) : {});
        } catch {
          if (alive) setSettings({});
        }
      } finally {
        if (alive) setLoaded(true);
      }
    };

    void load();

    return () => {
      alive = false;
    };
  }, []);

  const saveSettings = async (next: any) => {
    setSettings(next);
    mirrorSettings(next);
    setSaving(true);

    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });

      if (!res.ok) throw new Error(`SETTINGS_POST_${res.status}`);
    } catch (error) {
      console.error("Freebies speichern fehlgeschlagen:", error);
      alert("Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  };

  const fb = getFreebies(settings);

  const updateFb = (patch: Partial<typeof FB_DEFAULT>) => {
    const nextFb = { ...fb, ...patch };

    const nextSettings = {
      ...settings,
      freebies: nextFb,
      offers: {
        ...(settings?.offers ?? {}),
        freebies: nextFb,
      },
    };

    void saveSettings(nextSettings);
  };

  if (!loaded) {
    return <main className="p-6">Lädt…</main>;
  }

  return (
    <main className="mx-auto grid max-w-7xl gap-6 p-6 lg:grid-cols-[260px_1fr]">
      <AdminSidebar />

      <section className="card">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">Gratis-Artikel Regel</div>
            <div className="text-sm text-stone-400">
              Schwellenwert, Zielkategorie und Modus für kostenlose Artikel.
            </div>
          </div>

          {saving && <span className="text-xs text-stone-400">Speichert…</span>}
        </div>

        <div className="mb-4 flex items-center gap-3">
          <span>Aktiv</span>
          <Toggle checked={fb.enabled} onChange={(value) => updateFb({ enabled: value })} />
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Mindestwert (€)">
            <input
              type="number"
              step="0.01"
              value={String(getTierMinTotal(fb))}
              onChange={(event) => {
                const minTotal = Math.max(0, Number(event.target.value || 0));
                updateFb({
                  tiers: [{ minTotal, freeSauces: getTierFreeCount(fb) || 1 }],
                });
              }}
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
            />
          </Field>

          <Field label="Gratis-Anzahl">
            <input
              type="number"
              min={0}
              value={String(getTierFreeCount(fb))}
              onChange={(event) => {
                const freeSauces = Math.max(0, Number(event.target.value || 0));
                updateFb({
                  tiers: [{ minTotal: getTierMinTotal(fb), freeSauces }],
                });
              }}
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
            />
          </Field>

          <Field label="Zielkategorie">
            <select
              value={fb.category}
              onChange={(event) => updateFb({ category: event.target.value as FreebieTarget })}
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
            >
              <option value="sauces">Soßen</option>
              <option value="drinks">Getränke</option>
            </select>
          </Field>

          <Field label="Modus">
            <select
              value={fb.mode}
              onChange={(event) => updateFb({ mode: event.target.value as FreebieMode })}
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
            >
              <option value="both">Beide</option>
              <option value="delivery">Lieferung</option>
              <option value="pickup">Abholung</option>
            </select>
          </Field>
        </div>
      </section>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-stone-300/80">{label}</span>
      {children}
    </label>
  );
}