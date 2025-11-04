"use client";

import AdminSidebar from "@/components/admin/Sidebar"; // Dikkat: S büyük!
import Toggle from "@/components/ui/Toggle";            // Dikkat: T büyük!
import { useSettings } from "@/lib/useSettings";
import { Category } from "@/components/types";

const CATS: Category[] = ["burger", "vegan", "extras", "sauces", "drinks", "hotdogs"];

/** Boş/eksik durumlarda güvenli default */
const FB_DEFAULT = { enabled: false, category: "sauces" as const, mode: "both" as const, tiers: [] as {minTotal:number; freeSauces:number}[] };

export default function AdminFreebiesPage() {
  const { settings, setSettings, loaded } = useSettings();
  if (!loaded) return <main className="p-6">Lädt…</main>;

  const fb = settings.freebies ?? FB_DEFAULT;

  /** Ayar yazarken freebies alanı yoksa otomatik oluşturur */
  const updateFb = (patch: Partial<typeof fb>) =>
    setSettings((s) => ({
      ...s,
      freebies: { ...(s.freebies ?? FB_DEFAULT), ...patch },
    }));

  return (
    <main className="mx-auto max-w-7xl p-6 grid gap-6 lg:grid-cols-[260px_1fr]">
      <AdminSidebar />
      <section className="card">
        <div className="mb-3 text-lg font-semibold">Ücretsiz Sos Kuralı</div>

        <div className="mb-3 flex items-center gap-3">
          <span>Aktif</span>
          <Toggle checked={fb.enabled} onChange={(v) => updateFb({ enabled: v })} />
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Minimum sepet (€)">
            <input
              type="number"
              step="0.01"
              value={String(getTierMinTotal(fb) ?? 0)}
              onChange={(e) => {
                const val = Number(e.target.value || 0);
                // Tek kademeli basit kural: minTotal + 1 adet ücretsiz sos
                updateFb({ tiers: [{ minTotal: val, freeSauces: 1 }] });
              }}
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
            />
          </Field>

          <Field label="Ücretsiz sos sayısı">
            <input
              type="number"
              min={0}
              value={String(getTierFreeCount(fb) ?? 0)}
              onChange={(e) => {
                const cnt = Math.max(0, Number(e.target.value || 0));
                const minTotal = getTierMinTotal(fb) ?? 0;
                updateFb({ tiers: [{ minTotal, freeSauces: cnt }] });
              }}
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
            />
          </Field>

          <Field label="Hedef kategori">
            <select
              value={fb.category}
              onChange={(e) => updateFb({ category: e.target.value as Category })}
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
            >
              {CATS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
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

function getTierMinTotal(fb: typeof FB_DEFAULT | any) {
  return Array.isArray(fb.tiers) && fb.tiers[0]?.minTotal != null ? fb.tiers[0].minTotal : 0;
}
function getTierFreeCount(fb: typeof FB_DEFAULT | any) {
  return Array.isArray(fb.tiers) && fb.tiers[0]?.freeSauces != null ? fb.tiers[0].freeSauces : 0;
}
