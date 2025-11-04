"use client";
import AdminSidebar from "@/components/admin/Sidebar";
import Toggle from "@/components/ui/Toggle";
import { useSettings } from "@/lib/settings";
import { Category } from "@/components/types";

const CATS: Category[] = ["burger","vegan","extras","sauces","drinks","hotdogs"];

export default function AdminFreebiesPage(){
  const { settings, setSettings, loaded } = useSettings();
  if(!loaded) return <main className="p-6">Lädt…</main>;
  const fb = settings.freebies;

  return (
    <main className="mx-auto max-w-7xl p-6 grid gap-6 lg:grid-cols-[260px_1fr]">
      <AdminSidebar />
      <section className="card">
        <div className="mb-3 text-lg font-semibold">Ücretsiz Sos Kuralı</div>
        <div className="mb-3 flex items-center gap-3">
          <span>Aktif</span>
          <Toggle checked={fb.enabled} onChange={(v)=>setSettings(s=>({...s, freebies:{...s.freebies, enabled:v}}))}/>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Minimum sepet (€)">
            <input type="number" step="0.01" value={String(fb.minOrder)}
              onChange={e=>setSettings(s=>({...s, freebies:{...s.freebies, minOrder:Number(e.target.value)||0}}))}
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none" />
          </Field>
          <Field label="Ücretsiz sos sayısı">
            <input type="number" min={0} value={String(fb.freeCount)}
              onChange={e=>setSettings(s=>({...s, freebies:{...s.freebies, freeCount:Math.max(0,Number(e.target.value)||0)}}))}
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none" />
          </Field>
          <Field label="Hedef kategori">
            <select
              value={fb.targetCategory}
              onChange={e=>setSettings(s=>({...s, freebies:{...s.freebies, targetCategory:e.target.value as Category}}))}
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none">
              {CATS.map(c=> <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </div>
      </section>
    </main>
  );
}
function Field({label, children}:{label:string; children:React.ReactNode}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-stone-300/80">{label}</span>
      {children}
    </label>
  );
}
