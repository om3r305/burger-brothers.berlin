"use client";

import { showcaseCategoryLabel, type ShowcaseMenuPage } from "@/lib/showcase/runtime";
import type { ShowcaseProduct, ShowcaseScene } from "@/lib/showcase/types";

type Props = {
  scene: ShowcaseScene;
  products: ShowcaseProduct[];
  categories: string[];
  pages: ShowcaseMenuPage[];
  sceneDuration: number;
  inputClass: string;
  onChange: (patch: Partial<ShowcaseScene>, structural?: boolean) => void;
  onOnlyCategory: (category: string) => void;
  onToggleCategory: (category: string) => void;
  onClearCategories: () => void;
};
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block space-y-1.5"><span className="text-sm font-semibold text-stone-200">{label}</span>{children}</label>; }

export default function MenuSceneEditor({ scene, products, categories, pages, sceneDuration, inputClass, onChange, onOnlyCategory, onToggleCategory, onClearCategories }: Props) {
  if (scene.type !== "menu") return null;
  const selected = scene.menuCategories || [];
  return <section className="rounded-2xl border border-violet-700/40 bg-violet-950/20 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-xs font-black uppercase tracking-[.16em] text-violet-300">Gruplu dijital menü</div><h3 className="mt-1 font-black text-white">Menü sayfalarını veritabanından otomatik oluştur</h3><p className="mt-1 max-w-3xl text-sm leading-relaxed text-stone-300">Kategori seçilmezse tüm aktif kategoriler güvenli varsayılan olarak gösterilir.</p></div><div className="rounded-xl border border-violet-700/40 bg-black/25 px-3 py-2 text-xs text-violet-100">{pages.length} sayfa · toplam {sceneDuration} saniye</div></div>
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-stone-800 bg-stone-950/55 p-3"><span className="text-sm font-bold text-white">Seçilen gruplar:</span>{selected.length ? selected.map((category) => <span key={category} className="rounded-full bg-violet-500/15 px-3 py-1 text-xs font-bold text-violet-100">{showcaseCategoryLabel(category, "tr")}</span>) : <span className="text-xs text-emerald-300">Tüm aktif kategoriler otomatik gösterilecek</span>}<button type="button" onClick={onClearCategories} className="ml-auto rounded-lg border border-stone-700 px-3 py-1.5 text-xs font-bold text-stone-300 hover:bg-stone-800">Tümünü otomatik kullan</button></div>
    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{categories.map((category) => { const count=products.filter((product)=>product.category===category).length; const checked=selected.includes(category); return <div key={category} className={`rounded-xl border p-2 ${checked ? "border-violet-400 bg-violet-500/15" : "border-stone-800 bg-stone-950/70"}`}><button type="button" onClick={()=>onOnlyCategory(category)} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm"><span className={`font-bold ${checked ? "text-violet-50" : "text-stone-300"}`}>{checked ? "✓ " : ""}{showcaseCategoryLabel(category,"tr")}</span><span className="rounded-full bg-black/35 px-2 py-0.5 text-xs text-stone-300">{count}</span></button><button type="button" onClick={()=>onToggleCategory(category)} className="mt-1 w-full rounded-lg border border-stone-700/70 px-2 py-1 text-[11px] font-bold text-stone-400 hover:text-violet-100">{checked ? "Çoklu seçimden çıkar" : "Çoklu seçime ekle"}</button></div>; })}</div>
    {selected.length===0 ? <div className="mt-3 rounded-xl border border-emerald-700/40 bg-emerald-950/20 p-3 text-sm text-emerald-200">TV ekranı boş kalmaz: tüm aktif kategoriler otomatik kullanılacak.</div> : null}
    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <Field label="Kolon sayısı"><select className={inputClass} value={scene.menuColumns || 2} onChange={(event)=>onChange({menuColumns:Number(event.target.value)===3?3:2})}><option value={2}>2 kolon</option><option value={3}>3 kolon</option></select></Field>
      <Field label="Sayfa başına ürün"><input type="number" min={4} max={24} className={inputClass} value={scene.menuItemsPerPage || 8} onChange={(event)=>onChange({menuItemsPerPage:Number(event.target.value)})}/></Field>
      <Field label="Sayfa süresi"><input type="number" min={6} max={120} className={inputClass} value={scene.menuPageSeconds || 12} onChange={(event)=>onChange({menuPageSeconds:Number(event.target.value)})}/></Field>
      <Field label="Küçük ürün görselleri"><button type="button" onClick={()=>onChange({menuShowImages:scene.menuShowImages===false})} className={`${inputClass} text-left`}>{scene.menuShowImages===false?"Gizli":"Gösteriliyor"}</button></Field>
      <Field label={`Küçük görsel boyutu: ${Math.round(scene.menuImageSize || 58)} px`}><input type="range" min={36} max={104} step={2} disabled={scene.menuShowImages===false} className="w-full accent-orange-500 disabled:opacity-40" value={scene.menuImageSize || 58} onChange={(event)=>onChange({menuImageSize:Number(event.target.value)})}/></Field>
      <Field label="Kısa açıklamalar"><button type="button" onClick={()=>onChange({menuShowDescriptions:!scene.menuShowDescriptions})} className={`${inputClass} text-left`}>{scene.menuShowDescriptions?"Gösteriliyor":"Gizli"}</button></Field>
    </div>
  </section>;
}
