"use client";

import type { ShowcaseScreen } from "@/lib/showcase/types";

type Props = {
  screenSlug: string;
  screens: ShowcaseScreen[];
  busy: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onScreenChange: (slug: string) => void;
  onRefresh: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onRestore: () => void;
  onSave: () => void;
  onPublish: () => void;
};
export default function ShowcaseAdminHeader(props: Props) {
  return <header className="flex flex-wrap items-center gap-3 rounded-2xl border border-stone-800 bg-stone-900/60 p-4 shadow-xl">
    <div><div className="text-xs font-bold uppercase tracking-[.2em] text-orange-400">Dijital Vitrin</div><h1 className="mt-1 text-2xl font-black text-white">Vitrin Yönetimi</h1><p className="text-sm text-stone-400">Sahneleri hazırla, canlı önizle ve kontrol ettikten sonra yayınla.</p></div>
    <div className="ml-auto flex flex-wrap items-center gap-2">
      <select value={props.screenSlug} onChange={(event)=>props.onScreenChange(event.target.value)} className="rounded-xl border border-violet-500/50 bg-violet-950 px-4 py-2.5 text-sm font-black text-violet-100">{props.screens.map((screen)=><option key={screen.slug} value={screen.slug}>{screen.name} · {screen.slug}</option>)}</select>
      <button onClick={props.onRefresh} disabled={props.busy} className="rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-2.5 text-sm font-semibold text-sky-100 disabled:opacity-50">Canlı verileri yenile</button>
      <a href={`/showcase/${props.screenSlug}`} target="_blank" rel="noreferrer" className="rounded-xl border border-stone-700 bg-stone-950 px-4 py-2.5 text-sm font-semibold">TV ekranını aç ↗</a>
      <button type="button" onClick={props.onUndo} disabled={!props.canUndo||props.busy} className="rounded-xl border border-stone-700 px-3 py-2.5 text-sm font-semibold disabled:opacity-35" title="Ctrl+Z">↶ Geri al</button>
      <button type="button" onClick={props.onRedo} disabled={!props.canRedo||props.busy} className="rounded-xl border border-stone-700 px-3 py-2.5 text-sm font-semibold disabled:opacity-35" title="Ctrl+Y">↷ Yinele</button>
      <button onClick={props.onRestore} disabled={props.busy} className="rounded-xl border border-stone-700 px-4 py-2.5 text-sm font-semibold disabled:opacity-50">Son yayınlananı yükle</button>
      <button onClick={props.onSave} disabled={props.busy} className="rounded-xl border border-orange-500/50 bg-orange-500/10 px-4 py-2.5 text-sm font-bold text-orange-200 disabled:opacity-50">Taslağı kaydet</button>
      <button onClick={props.onPublish} disabled={props.busy} className="rounded-xl bg-orange-500 px-5 py-2.5 text-sm font-black text-black disabled:opacity-50">Yayınla</button>
    </div>
  </header>;
}
