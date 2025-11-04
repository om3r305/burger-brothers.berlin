"use client";
import Image from "next/image";
import { useState } from "react";
import type { MenuItem, ExtraOption } from "./types";
import { useCart } from "./store";

const fmt=(n:number)=> new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR"}).format(n);

export default function MenuGrid({items, sizzleSrc}:{items:MenuItem[]; sizzleSrc?:string;}){
  const [audioOn,setAudioOn]=useState(false);
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(it => <Card key={it.id} item={it} onHover={(h)=>setAudioOn(h)} />)}
      <audio preload="none" src={sizzleSrc||""} autoPlay={audioOn}/>
    </div>
  );
}

function Card({item,onHover}:{item:MenuItem;onHover:(h:boolean)=>void;}){
  const [open,setOpen]=useState(false);
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-stone-700/50 bg-stone-900/40 shadow hover:shadow-amber-900/20">
      <div onMouseEnter={()=>onHover(true)} onMouseLeave={()=>onHover(false)} className="relative h-56 w-full overflow-hidden">
        {!item.videoUrl ? (
          <Image src={item.imageUrl || "/placeholder.png"} alt={item.name} fill className="object-cover" />
        ) : (
          <video src={item.videoUrl} className="h-full w-full object-cover" autoPlay loop muted playsInline />
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/60 to-transparent"/>
      </div>
      <div className="flex flex-col gap-2 p-4">
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold">{item.name}</div>
          <div className="text-right font-semibold">{fmt(item.price)}</div>
        </div>
        {item.description && <div className="text-sm text-stone-300">{item.description}</div>}
        <button onClick={()=>setOpen(true)} className="mt-2 rounded-md bg-amber-600/90 px-3 py-2 text-black">Anpassen & In den Warenkorb</button>
      </div>
      {open && <Customize item={item} onClose={()=>setOpen(false)} />}
    </div>
  );
}

function Customize({item,onClose}:{item:MenuItem;onClose:()=>void;}){
  const [remove,setRemove]=useState<string[]>([]);
  const [add,setAdd]=useState<ExtraOption[]>([]);
  const [qty,setQty]=useState(1);
  const [note,setHinweise]=useState("");
  const addToCart = useCart(s=>s.addToCart);

  const toggleRemove=(ing:string)=> setRemove(p=> p.includes(ing)? p.filter(x=>x!==ing) : [...p,ing]);
  const toggleAdd=(opt:ExtraOption)=> setAdd(p=> p.find(x=>x.id===opt.id)? p.filter(x=>x.id!==opt.id) : [...p,opt]);

  const price=item.price+add.reduce((a,b)=>a+b.price,0);
  const priceFmt=(n:number)=> new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR"}).format(n);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose}/>
      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-stone-700/60 bg-stone-900 p-4">
        <div className="mb-2 text-lg font-semibold">{item.name}</div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          {item.removable && (
            <div>
              <div className="mb-1 font-medium">Zutaten entfernen</div>
              {item.removable.map(r=>(
                <label key={r} className="mb-1 flex items-center gap-2">
                  <input type="checkbox" checked={remove.includes(r)} onChange={()=>toggleRemove(r)}/>
                  <span>{r}</span>
                </label>
              ))}
            </div>
          )}

          {item.addable && (
            <div>
              <div className="mb-1 font-medium">Extras hinzufügen</div>
              {item.addable.map(opt=>(
                <label key={opt.id} className="mb-1 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <input type="checkbox" checked={!!add.find(a=>a.id===opt.id)} onChange={()=>toggleAdd(opt)}/>
                    {opt.name}
                  </span>
                  <span className="text-stone-300">{priceFmt(opt.price)}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="mt-3">
          <div className="mb-1 text-sm font-medium">Hinweis / Erklärung (optional)</div>
          <textarea value={note} onChange={e=>setHinweise(e.target.value)} rows={3} className="w-full rounded-md bg-stone-800/70 px-3 py-2 text-sm" placeholder="z. B.: gut durch, keine Sauce, extra spicy…"/>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button className="rounded-md bg-stone-800 px-2 py-1" onClick={()=>setQty(q=>Math.max(1,q-1))}>-</button>
            <span>{qty}</span>
            <button className="rounded-md bg-stone-800 px-2 py-1" onClick={()=>setQty(q=>q+1)}>+</button>
          </div>
          <div className="font-medium">{priceFmt(price*qty)}</div>
        </div>

        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md bg-stone-700 px-3 py-2">Abbrechen</button>
          <button
            onClick={()=>{ addToCart({item, add, rm:remove, qty, note}); onClose(); }}
            className="rounded-md bg-amber-600/90 px-3 py-2 text-black"
          >
            In den Warenkorb
          </button>
        </div>
      </div>
    </div>
  );
}
