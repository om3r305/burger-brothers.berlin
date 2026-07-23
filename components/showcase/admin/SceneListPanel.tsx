"use client";

import { CANONICAL_SCENE_TYPES, TYPE_ICONS, TYPE_LABELS, canonicalSceneType, type CanonicalShowcaseSceneType } from "@/lib/showcase/editor";
import { effectiveShowcaseSceneDuration } from "@/lib/showcase/runtime";
import type { ShowcaseDocument, ShowcaseSnapshot } from "@/lib/showcase/types";

type Props = {
  document: ShowcaseDocument;
  selectedId: string;
  snapshot: ShowcaseSnapshot;
  onEnabledChange: (enabled: boolean) => void;
  onAdd: (type: CanonicalShowcaseSceneType) => void;
  onSelect: (id: string) => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
};

export default function SceneListPanel({ document, selectedId, snapshot, onEnabledChange, onAdd, onSelect, onMove, onDuplicate, onDelete }: Props) {
  return <aside className="space-y-4 rounded-2xl border border-stone-800 bg-stone-900/55 p-4">
    <div className="flex items-center justify-between"><div><h2 className="font-black">Sahneler</h2><p className="text-xs text-stone-500">{document.scenes.length} sahne · 11 sade tür</p></div><label className="flex items-center gap-2 text-xs text-stone-400">Aktif<input type="checkbox" checked={document.enabled} onChange={(event)=>onEnabledChange(event.target.checked)}/></label></div>
    <div className="grid grid-cols-4 gap-1.5">{CANONICAL_SCENE_TYPES.map((type)=><button key={type} onClick={()=>onAdd(type)} title={`${TYPE_LABELS[type]} ekle`} className="rounded-xl border border-stone-800 bg-stone-950 px-2 py-2 text-lg hover:border-orange-500/60 hover:bg-stone-900">{TYPE_ICONS[type]}</button>)}</div>
    <div className="max-h-[690px] space-y-2 overflow-y-auto pr-1">{document.scenes.map((scene,index)=><button key={scene.id} onClick={()=>onSelect(scene.id)} className={["w-full rounded-xl border p-3 text-left transition",scene.id===selectedId?"border-orange-500 bg-orange-500/10":"border-stone-800 bg-stone-950/70 hover:border-stone-600"].join(" ")}><div className="flex items-start gap-2"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-stone-800 text-base">{TYPE_ICONS[canonicalSceneType(scene.type)]}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{index+1}. {scene.name}</span><span className="mt-1 block text-xs text-stone-500">{TYPE_LABELS[canonicalSceneType(scene.type)]} · {effectiveShowcaseSceneDuration(scene,snapshot)} sn.</span></span><span className={`mt-1 h-2.5 w-2.5 rounded-full ${scene.enabled?"bg-emerald-400":"bg-stone-600"}`}/></div></button>)}</div>
    <div className="grid grid-cols-4 gap-2 border-t border-stone-800 pt-3"><button onClick={()=>onMove(-1)} className="rounded-lg bg-stone-800 px-2 py-2 text-sm hover:bg-stone-700">↑</button><button onClick={()=>onMove(1)} className="rounded-lg bg-stone-800 px-2 py-2 text-sm hover:bg-stone-700">↓</button><button onClick={onDuplicate} className="rounded-lg bg-stone-800 px-2 py-2 text-sm hover:bg-stone-700">Kopyala</button><button onClick={onDelete} className="rounded-lg bg-red-950/70 px-2 py-2 text-sm text-red-300 hover:bg-red-900">Sil</button></div>
  </aside>;
}
