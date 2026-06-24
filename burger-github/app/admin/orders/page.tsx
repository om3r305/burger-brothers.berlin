
"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode, type ChangeEvent } from "react";

type Mode = "delivery" | "pickup";
type Category = "burger" | "vegan" | "extras" | "sauces" | "drinks" | "hotdogs";

type OrderItem = {
  id?: string;
  sku?: string;
  name: string;
  category?: Category | string;
  price: number;
  qty: number;
  add?: { label?: string; name?: string; price?: number }[];
  note?: string;
};

type OrderLog = {
  id: string;
  ts: number;
  mode: Mode;
  plz?: string | null;
  customerName?: string;
  phone?: string;
  addressLine?: string;
  note?: string;
  items: OrderItem[];
  merchandise?: number;
  discount?: number;
  surcharges?: number;
  total: number;
  status?: "new" | "preparing" | "ready" | "delivered" | "canceled";
};

const LS_ORDERS = "bb_orders_v1";

const fmtEur = (n: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);
const rid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto? (crypto as any).randomUUID(): String(Date.now() + Math.random()));
const sum = (arr:number[]) => arr.reduce((a,b)=>a+(Number.isFinite(b)?b:0),0);

function toInputDatetime(d: Date) {
  const pad = (n: number) => String(n).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const startOfDay = (d:Date)=>{ const x=new Date(d); x.setHours(0,0,0,0); return x; };
const endOfDay = (d:Date)=>{ const x=new Date(d); x.setHours(23,59,59,999); return x; };
const csvEscape = (s:string)=> /[",;\n]/.test(s)? `"${s.replace(/"/g,'""')}"` : s;

function normalizeOrders(arr: any[]): OrderLog[] {
  if (!Array.isArray(arr)) return [];
  const safe: OrderLog[] = [];
  for (const raw of arr) {
    try {
      const id = raw?.id ? String(raw.id) : rid();
      const ts = Number(raw?.ts) || Date.now();
      const mode: Mode = raw?.mode === "pickup" ? "pickup" : "delivery";
      const plz = raw?.plz != null ? String(raw.plz) : null;
      const itemsArr: any[] = Array.isArray(raw?.items) ? raw.items : [];
      const items: OrderItem[] = itemsArr.map((it: any) => ({
        id: it?.id ? String(it.id) : undefined,
        sku: it?.sku ? String(it.sku) : undefined,
        name: String(it?.name ?? "Artikel"),
        category: it?.category ? String(it.category) : undefined,
        price: Number(it?.price) || 0,
        qty: Number(it?.qty) || 0,
        note: it?.note ? String(it.note) : undefined,
        add: Array.isArray(it?.add)? it.add.map((a: any) => ({label: a?.label? String(a.label): a?.name? String(a.name): undefined, name: a?.name? String(a.name): undefined, price: Number(a?.price) || 0 })): undefined,
      }));
      const merchandise = Number(raw?.merchandise);
      const discount = Number(raw?.discount);
      const surcharges = Number(raw?.surcharges);
      const total = Number(raw?.total) || sum(items.map((i) => (i.price || 0) * (i.qty || 0)));
      safe.push({
        id, ts, mode, plz, customerName: raw?.customerName ? String(raw.customerName) : undefined,
        phone: raw?.phone ? String(raw.phone) : undefined, addressLine: raw?.addressLine ? String(raw.addressLine) : undefined,
        note: raw?.note ? String(raw.note) : undefined, items, merchandise: Number.isFinite(merchandise) ? merchandise : undefined,
        discount: Number.isFinite(discount) ? discount : undefined, surcharges: Number.isFinite(surcharges) ? surcharges : undefined,
        total, status: (["new","preparing","ready","delivered","canceled"].includes(raw?.status)? raw.status: "new") as OrderLog["status"]
      });
    } catch {}
  }
  safe.sort((a,b)=> b.ts - a.ts);
  return safe;
}

export default function AdminOrdersPage(){
  const [orders, setOrders] = useState<OrderLog[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const today = new Date();
  const defaultFrom = useRef(toInputDatetime(startOfDay(new Date(today.getTime() - 86400000))));
  const defaultTo = useRef(toInputDatetime(endOfDay(today)));
  const [from, setFrom] = useState(defaultFrom.current);
  const [to, setTo] = useState(defaultTo.current);
  const [mode, setMode] = useState<"all"|Mode>("all");
  const [status, setStatus] = useState<"all"|NonNullable<OrderLog["status"]>>("all");
  const [plz, setPlz] = useState("");
  const [q, setQ] = useState("");

  useEffect(()=>{
    try { const raw = localStorage.getItem(LS_ORDERS); const arr = raw? JSON.parse(raw): []; setOrders(normalizeOrders(arr)); }
    catch { setOrders([]); }
  },[]);

  const persist = (next:OrderLog[])=>{
    setOrders(next);
    try { localStorage.setItem(LS_ORDERS, JSON.stringify(next)); } catch {}
  };

  const list = useMemo(()=>{
    const fromTs = from ? Date.parse(from) : -Infinity;
    const toTs = to ? Date.parse(to) : Infinity;
    const text = q.trim().toLowerCase();
    const plzQ = plz.trim();
    return orders.filter((o)=>{
      if (!(o.ts >= fromTs && o.ts <= toTs)) return false;
      if (mode !== "all" && o.mode !== mode) return false;
      if (status !== "all" && (o.status || "new") !== status) return false;
      if (plzQ && (o.plz || "").toString() !== plzQ) return false;
      if (text){
        const inHeader = (o.customerName||"").toLowerCase().includes(text) || (o.phone||"").toLowerCase().includes(text) || (o.addressLine||"").toLowerCase().includes(text) || (o.id||"").toLowerCase().includes(text);
        if (inHeader) return true;
        const inItems = o.items?.some((it)=> (it.name||"").toString().toLowerCase().includes(text));
        if (!inItems) return false;
      }
      return true;
    });
  },[orders,from,to,mode,status,plz,q]);

  const kpi = useMemo(()=>{
    const count = list.length;
    const revenue = sum(list.map((o)=>o.total));
    const avg = count? revenue / count : 0;
    const canceled = list.filter((o)=>o.status==="canceled").length;
    return { count, revenue, avg, canceled };
  },[list]);

  const setOrderStatus = (id:string, s:NonNullable<OrderLog["status"]>)=> persist(orders.map((o)=> o.id===id? { ...o, status: s } : o));
  const delOrder = (id:string)=>{ if(!confirm("Bu siparişi silmek istediğine emin misin?")) return; persist(orders.filter((o)=>o.id!==id)); };
  const duplicateOrder = (id:string)=>{ const src = orders.find((o)=>o.id===id); if(!src) return; const copy:OrderLog={...src, id: crypto.randomUUID?.() || String(Date.now()), ts: Date.now(), status: "new"}; persist([copy, ...orders]); };

  const exportJSON = ()=>{
    try { const blob = new Blob([JSON.stringify(list, null, 2)], { type:"application/json" }); const url = URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download="orders.json"; a.click(); URL.revokeObjectURL(url); } catch {}
  };
  const exportCSV = ()=>{
    try {
      const header = "order_id;datetime;mode;status;plz;customer;phone;address;item;category;qty;unit_price;line_total;order_total\n";
      const lines:string[]=[];
      for(const o of list){
        const dt = new Date(o.ts).toISOString();
        if (!o.items?.length){
          lines.push([o.id,dt,o.mode,o.status||"",o.plz||"",o.customerName||"",o.phone||"",o.addressLine||"","","","0","0","0",String(o.total).replace(".",",")].map(csvEscape).join(";"));
          continue;
        }
        for(const it of o.items){
          const addSum = (it.add||[]).reduce((a,b)=>a+(Number(b?.price)||0),0) || 0;
          const unit = Number(it.price)+addSum;
          const lt = unit * Number(it.qty||0);
          lines.push([o.id,dt,o.mode,o.status||"",o.plz||"",o.customerName||"",o.phone||"",o.addressLine||"",it.name||"", (it.category||"").toString(), String(it.qty||0).replace(".",","), unit.toFixed(2).replace(".",","), lt.toFixed(2).replace(".",","), o.total.toFixed(2).replace(".",",") ].map(csvEscape).join(";"));
        }
      }
      const blob = new Blob([header+lines.join("\n")], { type:"text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download="orders.csv"; a.click(); URL.revokeObjectURL(url);
    } catch {}
  };
  const onImport = async (ev:ChangeEvent<HTMLInputElement>)=>{
    const f = ev.target.files?.[0]; if(!f) return;
    try { const txt = await f.text(); const safe = normalizeOrders(JSON.parse(txt)); persist(safe); ev.target.value=""; alert(`Import OK ✅\nKayıt: ${safe.length}`); }
    catch(e:any){ ev.target.value=""; alert("Import hatası. JSON geçersiz.\n"+(e?.message||"")); }
  };

  const addDummy = ()=>{
    const o:OrderLog={ id: crypto.randomUUID?.() || String(Date.now()), ts: Date.now(), mode: Math.random()>0.5? "delivery":"pickup", plz: "13507", customerName: "Max Mustermann", phone: "+49 123 456789", addressLine: "Berliner Str. 1", items:[ { name:"Classic Burger", category:"burger", price:9.9, qty:1 }, { name:"Fries", category:"extras", price:3.5, qty:1 }, { name:"Ketchup", category:"sauces", price:0.5, qty:1 } ], merchandise:13.9, discount:0, surcharges: Math.random()>0.5? 1.5: 0, total: 13.9 + (Math.random()>0.5? 1.5: 0), status:"new" };
    persist([o, ...orders]);
  };
  const resetFilters = ()=>{ setFrom(defaultFrom.current); setTo(defaultTo.current); setMode("all"); setStatus("all"); setPlz(""); setQ(""); };

  return (
    <main className="mx-auto max-w-7xl p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold">Siparişler</h1>
          <Link href="/admin" className="text-sm text-stone-300 hover:text-stone-100">← Admin</Link>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-ghost" onClick={addDummy}>Dummy Ekle</button>
          <button className="btn-ghost" onClick={exportJSON}>Export JSON</button>
          <button className="btn-ghost" onClick={exportCSV}>Export CSV</button>
          <label className="btn-ghost cursor-pointer">Import JSON
            <input type="file" accept="application/json,.json" hidden onChange={onImport}/>
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-6 mb-4">
        <KPI title="Sipariş" value={String(kpi.count)} />
        <KPI title="Ciro" value={fmtEur(kpi.revenue)} />
        <KPI title="Ort. Sepet" value={fmtEur(kpi.avg)} />
        <KPI title="İptal" value={String(kpi.canceled)} />
      </div>

      <div className="card mb-6">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Başlangıç">
            <input type="datetime-local" value={from} onChange={(e)=>setFrom(e.target.value)} className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"/>
          </Field>
          <Field label="Bitiş">
            <input type="datetime-local" value={to} onChange={(e)=>setTo(e.target.value)} className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"/>
          </Field>
          <Field label="Mod">
            <select value={mode} onChange={(e)=>setMode(e.target.value as any)} className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none">
              <option value="all">Tümü</option><option value="delivery">Liefern</option><option value="pickup">Abholen</option>
            </select>
          </Field>
          <Field label="Durum">
            <select value={status} onChange={(e)=>setStatus(e.target.value as any)} className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none">
              <option value="all">Tümü</option><option value="new">Yeni</option><option value="preparing">Hazırlanıyor</option><option value="ready">Hazır</option><option value="delivered">Teslim</option><option value="canceled">İptal</option>
            </select>
          </Field>
          <Field label="PLZ"><input value={plz} onChange={(e)=>setPlz(e.target.value)} placeholder="13507" className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"/></Field>
          <Field label="Arama (isim/ürün)"><input value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Müşteri veya ürün" className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"/></Field>
          <div className="flex items-end"><button className="btn-ghost w-full" onClick={resetFilters}>Filtreleri sıfırla</button></div>
        </div>
      </div>

      <div className="card">
        <div className="mb-3 font-medium">Siparişler ({list.length})</div>
        {list.length===0? (<div className="text-sm opacity-70">Kayıt yok.</div>) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-stone-900/80 backdrop-blur">
                <tr className="[&>th]:px-3 [&>th]:py-2 text-left">
                  <th>Zaman</th><th>ID</th><th>Mod</th><th>Durum</th><th>Müşteri</th><th>PLZ</th><th>Ürün Sayısı</th><th>Toplam</th><th className="text-right">Aksiyon</th>
                </tr>
              </thead>
              <tbody>
                {list.map((o)=>{
                  const itemsQty = sum(o.items?.map((i)=>i.qty)||[]);
                  const isOpen = expanded===o.id;
                  return (
                    <FragmentRow key={o.id} order={o} isOpen={isOpen} itemsQty={itemsQty}
                      onToggle={()=>setExpanded(isOpen? null: o.id)} onSetStatus={setOrderStatus} onDelete={delOrder} onDuplicate={duplicateOrder}/>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (<label className="block text-sm"><span className="mb-1 block text-stone-300/80">{label}</span>{children}</label>);
}
function KPI({ title, value }: { title: string; value: string }) {
  return (<div className="rounded-xl border border-stone-700/60 bg-stone-900/60 p-4"><div className="text-xs uppercase tracking-wide text-stone-400">{title}</div><div className="mt-1 text-xl font-semibold">{value}</div></div>);
}
function StatusBadge({ s }: { s?: OrderLog["status"] }) {
  const label = s==="preparing"?"Hazırlanıyor": s==="ready"?"Hazır": s==="delivered"?"Teslim": s==="canceled"?"İptal":"Yeni";
  const cls = s==="preparing"?"bg-amber-500 text-black": s==="ready"?"bg-emerald-500 text-black": s==="delivered"?"bg-stone-700 text-stone-100": s==="canceled"?"bg-red-500 text-white":"bg-sky-500 text-black";
  return <span className={`rounded px-2 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>;
}

function FragmentRow({ order, isOpen, itemsQty, onToggle, onSetStatus, onDelete, onDuplicate }:
 { order: OrderLog; isOpen: boolean; itemsQty: number; onToggle: () => void; onSetStatus: (id: string, s: NonNullable<OrderLog["status"]>) => void; onDelete: (id: string) => void; onDuplicate: (id: string) => void; }) {
  return (
    <>
      <tr className="border-t border-stone-800/60">
        <td className="px-3 py-2 whitespace-nowrap">{new Date(order.ts).toLocaleString()}</td>
        <td className="px-3 py-2">{order.id}</td>
        <td className="px-3 py-2">{order.mode === "pickup" ? "Abholen" : "Liefern"}</td>
        <td className="px-3 py-2"><StatusBadge s={order.status} /></td>
        <td className="px-3 py-2">{(order.customerName || "—") + (order.phone ? ` • ${order.phone}` : "")}</td>
        <td className="px-3 py-2">{order.plz || "—"}</td>
        <td className="px-3 py-2">{itemsQty}</td>
        <td className="px-3 py-2 font-semibold">{fmtEur(order.total)}</td>
        <td className="px-3 py-2 text-right">
          <div className="flex justify-end gap-2">
            <div className="relative inline-block">
              <details className="dropdown">
                <summary className="btn-ghost">Drucken ▾</summary>
                <div className="dropdown-menu">
                  <a className="btn-ghost" href={`/admin/print?type=kitchen&id=${order.id}`} target="_blank">Küche</a>
                  <a className="btn-ghost" href={`/admin/print?type=driver&id=${order.id}`} target="_blank">Fahrer</a>
                  <a className="btn-ghost" href={`/admin/print?type=full&id=${order.id}`} target="_blank">Komplett</a>
                </div>
              </details>
            </div>
            <button className="btn-ghost" onClick={onToggle}>{isOpen ? "Kapat" : "Detay"}</button>
            <div className="relative">
              <select value={order.status || "new"} onChange={(e)=>onSetStatus(order.id, e.target.value as any)}
                className="rounded-md border border-stone-700/60 bg-stone-950 px-2 py-1 text-xs outline-none" title="Durumu değiştir">
                <option value="new">Yeni</option><option value="preparing">Hazırlanıyor</option><option value="ready">Hazır</option><option value="delivered">Teslim</option><option value="canceled">İptal</option>
              </select>
            </div>
            <button className="btn-ghost" onClick={()=>onDuplicate(order.id)}>Kopyala</button>
            <button className="btn-ghost" onClick={()=>onDelete(order.id)}>Löschen</button>
          </div>
        </td>
      </tr>
      {isOpen && (
        <tr className="border-t border-stone-800/60 bg-stone-900/40">
          <td colSpan={9} className="px-3 py-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded border border-stone-700/60 p-3">
                <div className="text-sm font-semibold mb-2">Müşteri</div>
                <div className="text-sm text-stone-300">
                  <div>{order.customerName || "—"}</div>
                  <div>{order.phone || "—"}</div>
                  <div>{order.addressLine || "—"}</div>
                  <div>PLZ: {order.plz || "—"}</div>
                </div>
              </div>
              <div className="rounded border border-stone-700/60 p-3 md:col-span-2">
                <div className="text-sm font-semibold mb-2">Ürünler</div>
                <div className="grid gap-2">
                  {order.items.map((it, idx)=>{
                    const addSum = (it.add||[]).reduce((a,b)=>a+(Number(b?.price)||0),0) || 0;
                    const unit = Number(it.price)+addSum;
                    return (
                      <div key={idx} className="rounded border border-stone-700/60 bg-stone-950 px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-medium truncate">{it.name} <span className="opacity-70">×{it.qty}</span></div>
                            <div className="text-xs text-stone-400">
                              {(it.category || "—").toString()}
                              {it.add?.length? " • " + it.add.map((a)=>`${a.label || a.name || "extra"} (+${fmtEur(Number(a.price)||0)})`).join(", ") : ""}
                              {it.note? ` • Hinweis: ${it.note}`:""}
                            </div>
                          </div>
                          <div className="text-sm font-semibold whitespace-nowrap">{fmtEur(unit * (it.qty || 0))}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
              <div className="rounded border border-stone-700/60 p-3">
                <div className="text-sm font-semibold mb-2">Ödeme Özeti</div>
                <div className="text-sm text-stone-300 space-y-1">
                  <div className="flex justify-between"><span>Ara Toplam</span><span>{fmtEur(Number(order.merchandise ?? sum(order.items.map(i => (i.price + ((i.add?.reduce((a,b)=>a+(Number(b?.price)||0),0))||0)) * (i.qty||0)))) )}</span></div>
                  <div className="flex justify-between"><span>İndirim</span><span>{fmtEur(-(order.discount || 0))}</span></div>
                  <div className="flex justify-between"><span>Aufschlag</span><span>{fmtEur(order.surcharges || 0)}</span></div>
                  <div className="flex justify-between font-semibold"><span>Toplam</span><span>{fmtEur(order.total)}</span></div>
                </div>
              </div>
              <div className="rounded border border-stone-700/60 p-3 md:col-span-2">
                <div className="text-sm font-semibold mb-2">Hinweis</div>
                <div className="text-sm text-stone-300 min-h-[2rem] whitespace-pre-wrap">{order.note || "—"}</div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
