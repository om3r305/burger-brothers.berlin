// /app/admin/addresses/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  readStreetDB, writeStreetDB, getStreets,
  replacePLZ, upsertPLZ, removePLZ, filterStreets,
  importCSVToPLZ, exportCSV, type StreetDB
} from "@/lib/streets";

export default function AdminAddressesPage() {
  const [db, setDb] = useState<StreetDB>({});
  const [plz, setPlz] = useState("");
  const [q, setQ] = useState("");
  const [rawMulti, setRawMulti] = useState(""); // JSON/CSV çoklu içe aktar

  useEffect(() => setDb(readStreetDB()), []);

  const plzList = useMemo(() => Object.keys(db).sort(), [db]);
  const streets = useMemo(() => (plz.length === 5 ? filterStreets(plz, q) : []), [plz, q, db]);

  const onAddPLZ = () => {
    const code = prompt("PLZ (5 hane):", plz)?.replace(/\D/g, "").slice(0, 5) || "";
    if (!code) return;
    if (!db[code]) setDb(writeStreetDB({ ...db, [code]: [] }));
    setPlz(code);
  };
  const onRemovePLZ = (code: string) => {
    if (!confirm(`${code} silinsin mi?`)) return;
    setDb(removePLZ(code));
    if (plz === code) setPlz("");
  };

  const onExportCSV = () => {
    const csv = exportCSV(db);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "streets.csv"; a.click(); URL.revokeObjectURL(url);
  };
  const onExportJSON = () => {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "streets.json"; a.click(); URL.revokeObjectURL(url);
  };

  const onImportJSON = async (file: File) => {
    try {
      const txt = await file.text();
      const obj = JSON.parse(txt) as StreetDB;
      setDb(writeStreetDB(obj));
      alert("JSON içe aktarıldı ✅");
    } catch (e: any) {
      alert("JSON import hatası: " + (e?.message || ""));
    }
  };

  const onImportCSV = async (file: File) => {
    try {
      const txt = await file.text();
      const res = importCSVToPLZ(txt);
      if (Array.isArray(res)) {
        if (plz.length !== 5) {
          alert("Tek kolon CSV için önce PLZ seçin.");
          return;
        }
        setDb(replacePLZ(plz, res as string[]));
      } else {
        setDb(res as StreetDB);
      }
      alert("CSV içe aktarıldı ✅");
    } catch (e: any) {
      alert("CSV import hatası: " + (e?.message || ""));
    }
  };

  const onManualAddStreet = () => {
    if (plz.length !== 5) return;
    const name = prompt("Straße adı:");
    if (!name) return;
    setDb(upsertPLZ(plz, [name]));
  };

  const onReplaceWithTextarea = () => {
    if (plz.length !== 5) return;
    const lines = rawMulti.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    setDb(replacePLZ(plz, lines));
    setRawMulti("");
  };

  return (
    <main className="mx-auto max-w-6xl p-6 space-y-6">
      <div className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold">Adresseler (PLZ → Straßelar)</h1>
          <Link href="/admin" className="text-sm text-stone-300 hover:text-stone-100">← Admin</Link>
        </div>
        <div className="flex gap-2">
          <button className="pill" onClick={onExportCSV}>CSV Export</button>
          <button className="pill" onClick={onExportJSON}>JSON Export</button>

          <label className="btn-ghost cursor-pointer">
            JSON Import
            <input type="file" accept="application/json" hidden onChange={(e) => {
              const f = e.target.files?.[0]; if (f) onImportJSON(f); e.currentTarget.value = "";
            }} />
          </label>
          <label className="btn-ghost cursor-pointer">
            CSV Import
            <input type="file" accept=".csv,text/csv" hidden onChange={(e) => {
              const f = e.target.files?.[0]; if (f) onImportCSV(f); e.currentTarget.value = "";
            }} />
          </label>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-[280px,1fr]">
        {/* PLZ sütunu */}
        <section className="rounded-xl border border-stone-700/60 bg-stone-900/60 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="font-medium">PLZ’ler</div>
            <button className="pill" onClick={onAddPLZ}>Yeni PLZ</button>
          </div>
          <div className="space-y-1 max-h-[60vh] overflow-auto pr-1">
            {plzList.length === 0 && <div className="text-sm opacity-60">Henüz kayıt yok.</div>}
            {plzList.map((p) => (
              <div key={p} className={`flex items-center justify-between rounded px-2 py-1 ${plz === p ? "bg-stone-800/70" : ""}`}>
                <button className="text-left" onClick={() => setPlz(p)}>{p}</button>
                <button className="btn-ghost text-rose-300" onClick={() => onRemovePLZ(p)}>Löschen</button>
              </div>
            ))}
          </div>
        </section>

        {/* Straße listesi */}
        <section className="rounded-xl border border-stone-700/60 bg-stone-900/60 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-lg font-medium">PLZ: {plz || "—"}</div>
            <div className="flex gap-2">
              <button disabled={plz.length !== 5} className={`pill ${plz.length !== 5 ? "opacity-50" : ""}`} onClick={onManualAddStreet}>Straße ekle</button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr,260px]">
            <input
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Straßeta ara..."
              className="rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
            />
            <textarea
              rows={3}
              value={rawMulti}
              onChange={(e) => setRawMulti(e.target.value)}
              placeholder={"Çoklu ekleme (her satır bir sokak)\nÖrn:\nBorsigallee\nÖmer-Sevindik-Straße"}
              className="rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none font-mono text-xs"
            />
          </div>
          <div>
            <button disabled={plz.length !== 5 || !rawMulti.trim()} className={`btn-ghost ${plz.length !== 5 || !rawMulti.trim() ? "opacity-50" : ""}`} onClick={onReplaceWithTextarea}>Bu PLZ listesiyle değiştir</button>
          </div>

          <div className="rounded border border-stone-700/60 overflow-hidden max-h-[60vh]">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left opacity-70">
                  <th className="p-2">Straße</th>
                </tr>
              </thead>
              <tbody>
                {plz.length === 5 && streets.map((s) => (
                  <tr key={s} className="border-t border-stone-700/60"><td className="p-2">{s}</td></tr>
                ))}
                {plz.length === 5 && streets.length === 0 && (
                  <tr><td className="p-2 opacity-60">Kayıt yok veya filtre boş sonuç.</td></tr>
                )}
                {plz.length !== 5 && (
                  <tr><td className="p-2 opacity-60">Soldan bir PLZ seçin.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
