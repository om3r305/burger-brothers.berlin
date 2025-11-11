
"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

const LS_CUSTOMERS = "bb_customers_v1";

type Target = "optin" | "all_with_email";
export default function ComposerPage(){
  const [list, setList] = useState<any[]>([]);
  const [target, setTarget] = useState<Target>("optin");
  const [plz, setPlz] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [brochureUrl, setBrochureUrl] = useState("");

  useEffect(()=>{
    try { const raw = localStorage.getItem(LS_CUSTOMERS); const arr = raw? JSON.parse(raw): []; setList(Array.isArray(arr)? arr: []); } catch { setList([]); }
  },[]);

  const recipients = useMemo(()=>{
    let arr = list.filter((c)=> (c.email||"").includes("@"));
    if (target==="optin") arr = arr.filter((c)=> !!c.emailOptIn);
    if (plz.trim()) arr = arr.filter((c)=> (c.plz||"")===plz.trim());
    return arr;
  },[list,target,plz]);

  const mailtoHref = useMemo(()=>{
    const emails = recipients.map((r)=>r.email).join(",");
    const lines = [body, imageUrl? `\nBild: ${imageUrl}`:"", brochureUrl? `\nBroschüre: ${brochureUrl}`:"", "\n\n— Abmelden için: STOP yazabilirsiniz."].join("");
    return `mailto:${encodeURIComponent(emails)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines)}`;
  },[recipients, subject, body, imageUrl, brochureUrl]);

  const exportCSV = ()=>{
    try {
      const header = "name,email,plz\n";
      const lines = recipients.map((r)=> [r.name||"", r.email||"", r.plz||""].map((s)=> /[",\n]/.test(s)? `"${s.replace(/"/g,'""')}"`: s).join(",")).join("\n");
      const blob = new Blob([header+lines], { type:"text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download="optin.csv"; a.click(); URL.revokeObjectURL(url);
    } catch {}
  };

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-5">
      <div className="mb-2 flex items-baseline gap-3">
        <h1 className="text-2xl font-semibold">Kampanya E-postası</h1>
        <Link href="/admin" className="text-sm text-stone-300 hover:text-stone-100">← Admin</Link>
      </div>

      <div className="card">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="text-sm">Alıcılar
            <select value={target} onChange={(e)=>setTarget(e.target.value as Target)}
              className="mt-1 w-full rounded-md bg-stone-800/60 p-2 outline-none">
              <option value="optin">Nur Opt-in</option>
              <option value="all_with_email">E-maili olan herkes</option>
            </select>
          </label>
          <label className="text-sm">PLZ (opsiyonel)
            <input value={plz} onChange={(e)=>setPlz(e.target.value)} className="mt-1 w-full rounded-md bg-stone-800/60 p-2 outline-none"/>
          </label>
          <div className="text-sm flex items-end">Seçili: <b className="ml-1">{recipients.length}</b></div>
        </div>
      </div>

      <div className="card">
        <div className="grid grid-cols-1 gap-3">
          <label className="text-sm">Betreff
            <input value={subject} onChange={(e)=>setSubject(e.target.value)} className="mt-1 w-full rounded-md bg-stone-800/60 p-2 outline-none"/>
          </label>
          <label className="text-sm">Açıklama (HTML/text kabul)
            <textarea rows={8} value={body} onChange={(e)=>setBody(e.target.value)} className="mt-1 w-full rounded-md bg-stone-800/60 p-2 outline-none"/>
          </label>
          <label className="text-sm">Görsel URL
            <input value={imageUrl} onChange={(e)=>setImageUrl(e.target.value)} className="mt-1 w-full rounded-md bg-stone-800/60 p-2 outline-none"/>
          </label>
          <label className="text-sm">Broşür (PDF) URL
            <input value={brochureUrl} onChange={(e)=>setBrochureUrl(e.target.value)} className="mt-1 w-full rounded-md bg-stone-800/60 p-2 outline-none"/>
          </label>
        </div>
        <div className="mt-3 flex gap-2">
          <a href={mailtoHref} className="rounded-md bg-emerald-500 px-4 py-2 font-semibold text-black">Mailto Gönder</a>
          <button onClick={exportCSV} className="rounded-md bg-stone-700 px-4 py-2 font-semibold">Opt-in CSV indir</button>
        </div>
      </div>
    </main>
  );
}
