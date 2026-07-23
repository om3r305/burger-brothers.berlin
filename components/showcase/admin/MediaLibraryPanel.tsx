"use client";

import { useRef } from "react";
import type { ShowcaseMediaItem, ShowcaseScene } from "@/lib/showcase/types";

type StorageState = { configured: boolean; provider: "cloudinary"; cloudName: string; maxUploadBytes: number };
type Props = {
  scene: ShowcaseScene;
  media: ShowcaseMediaItem[];
  storage: StorageState;
  uploadProgress: number | null;
  inputClass: string;
  onChange: (patch: Partial<ShowcaseScene>) => void;
  onUpload: (file: File) => Promise<void>;
  onDelete: (item: ShowcaseMediaItem) => void;
};
function formatBytes(value:number){const bytes=Number(value||0);if(bytes<1024)return`${bytes} B`;if(bytes<1024**2)return`${(bytes/1024).toFixed(1)} KB`;if(bytes<1024**3)return`${(bytes/1024**2).toFixed(1)} MB`;return`${(bytes/1024**3).toFixed(2)} GB`;}
function Field({label,children,hint}:{label:string;children:React.ReactNode;hint?:string}){return <label className="block space-y-1.5"><span className="text-sm font-semibold text-stone-200">{label}</span>{children}{hint?<span className="block text-xs text-stone-500">{hint}</span>:null}</label>}

export default function MediaLibraryPanel({ scene, media, storage, uploadProgress, inputClass, onChange, onUpload, onDelete }: Props) {
  const fileRef=useRef<HTMLInputElement|null>(null);
  if(scene.type==="product"||scene.type==="menu")return null;
  return <section className="rounded-2xl border border-stone-800 bg-stone-950/60 p-4">
    <div className="flex flex-wrap items-center gap-3"><div><h3 className="font-black">Video ve görseller</h3><p className="text-xs text-stone-500">Dosyalar doğrudan Cloudinary alanına yüklenir.</p></div><button onClick={()=>fileRef.current?.click()} disabled={!storage.configured||uploadProgress!==null} className="ml-auto rounded-xl bg-stone-100 px-4 py-2 text-sm font-black text-black disabled:opacity-40">Dosya yükle</button><input ref={fileRef} type="file" hidden accept="video/mp4,video/webm,image/jpeg,image/png,image/webp,image/avif" onChange={(event)=>{const file=event.target.files?.[0];if(file)void onUpload(file).finally(()=>{if(fileRef.current)fileRef.current.value="";});}}/></div>
    {!storage.configured?<div className="mt-3 rounded-xl border border-amber-700/50 bg-amber-950/30 p-3 text-sm text-amber-200">Cloudinary henüz ayarlanmadı. Vercel ortam değişkenlerini kontrol et.</div>:null}
    {uploadProgress!==null?<div className="mt-3"><div className="mb-1 flex justify-between text-xs text-stone-400"><span>Yükleniyor</span><span>{uploadProgress}%</span></div><div className="h-2 overflow-hidden rounded-full bg-stone-800"><div className="h-full bg-orange-500 transition-all" style={{width:`${uploadProgress}%`}}/></div></div>:null}
    <div className="mt-3"><Field label="Doğrudan medya URL’si" hint="Harici bir dosya URL’si de kullanılabilir."><input className={inputClass} value={scene.mediaUrl||""} onChange={(event)=>onChange({mediaUrl:event.target.value})} placeholder="https://.../video.mp4"/></Field></div>
    {scene.type==="video"?<div className="mt-3"><Field label="Kapak görseli / Poster URL’si"><input className={inputClass} value={scene.posterUrl||""} onChange={(event)=>onChange({posterUrl:event.target.value})}/></Field></div>:null}
    {media.length?<div className="mt-4 grid max-h-72 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">{media.map((item)=><div key={item.id} className={`group relative overflow-hidden rounded-xl border ${scene.mediaUrl===item.url?"border-orange-500":"border-stone-800"} bg-stone-900`}><button onClick={()=>onChange({mediaUrl:item.url})} className="block w-full text-left"><div className="aspect-video bg-black">{item.mimeType.startsWith("image/")?<img src={item.url} alt="" className="h-full w-full object-cover"/>:<video src={item.url} muted preload="metadata" className="h-full w-full object-cover"/>}</div><div className="p-2"><div className="truncate text-xs font-bold">{item.name}</div><div className="mt-1 text-[10px] text-stone-500">{formatBytes(item.size)}{item.durationSeconds?` · ${item.durationSeconds}s`:""}</div></div></button><button onClick={()=>onDelete(item)} className="absolute right-1.5 top-1.5 rounded-lg bg-black/80 px-2 py-1 text-xs text-red-300 opacity-0 transition group-hover:opacity-100">Sil</button></div>)}</div>:null}
  </section>;
}
