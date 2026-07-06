"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

const LS_CUSTOMERS = "bb_customers_v1";
const API_CUSTOMERS = "/api/admin/customers";

type Target = "optin" | "all_with_email";

type Customer = {
  id: string;
  name: string;
  email?: string;
  plz?: string;
  emailOptIn?: boolean;
};

export default function ComposerPage() {
  const [list, setList] = useState<Customer[]>([]);
  const [target, setTarget] = useState<Target>("optin");
  const [plz, setPlz] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [brochureUrl, setBrochureUrl] = useState("");

  useEffect(() => {
    let alive = true;
    async function load() {
      // 1) DB
      try {
        const r = await fetch(API_CUSTOMERS, { cache: "no-store" });
        const j = await r.json().catch(() => ({} as any));
        const items = Array.isArray(j?.items) ? (j.items as Customer[]) : [];
        if (alive && items.length) {
          setList(items);
          try {
            localStorage.setItem(LS_CUSTOMERS, JSON.stringify(items));
          } catch {}
          return;
        }
      } catch {
        // ignore
      }

      // 2) Fallback LS
      try {
        const raw = localStorage.getItem(LS_CUSTOMERS);
        const arr = raw ? JSON.parse(raw) : [];
        if (alive) setList(Array.isArray(arr) ? arr : []);
      } catch {
        if (alive) setList([]);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, []);

  const recipients = useMemo(() => {
    let arr = list.filter((c) => (c.email || "").includes("@"));
    if (target === "optin") arr = arr.filter((c) => !!c.emailOptIn);
    const z = plz.trim();
    if (z) arr = arr.filter((c) => (c.plz || "") === z);
    return arr;
  }, [list, target, plz]);

  const mailtoHref = useMemo(() => {
    const emails = recipients.map((r) => r.email).join(",");
    const lines = [
      body.trim(),
      imageUrl.trim() ? `\n\nBild: ${imageUrl.trim()}` : "",
      brochureUrl.trim() ? `\n\nProspekt (PDF): ${brochureUrl.trim()}` : "",
      "\n\n— Abmelden: Antworten Sie mit STOP.",
    ].join("");
    return `mailto:${encodeURIComponent(emails)}?subject=${encodeURIComponent(
      subject.trim()
    )}&body=${encodeURIComponent(lines)}`;
  }, [recipients, subject, body, imageUrl, brochureUrl]);

  const exportCSV = () => {
    try {
      const header = "name,email,plz\n";
      const lines = recipients
        .map((r) =>
          [r.name || "", r.email || "", r.plz || ""]
            .map((s) =>
              /[\",\n]/.test(String(s))
                ? `"${String(s).replace(/"/g, '""')}"`
                : String(s)
            )
            .join(",")
        )
        .join("\n");
      const blob = new Blob([header + lines], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "kunden_optin.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch {}
  };

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-5">
      <div className="mb-2 flex items-baseline gap-3">
        <h1 className="text-2xl font-semibold">Kampagnen-E-Mail</h1>
        <Link href="/admin" className="text-sm text-stone-300 hover:text-stone-100">
          ← Admin
        </Link>
      </div>

      <div className="card">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="text-sm">
            Empfänger
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value as Target)}
              className="mt-1 w-full rounded-md bg-stone-800/60 p-2 outline-none"
            >
              <option value="optin">Nur Opt-in</option>
              <option value="all_with_email">Alle mit E-Mail</option>
            </select>
          </label>
          <label className="text-sm">
            PLZ (optional)
            <input
              value={plz}
              onChange={(e) => setPlz(e.target.value)}
              className="mt-1 w-full rounded-md bg-stone-800/60 p-2 outline-none"
            />
          </label>
          <div className="text-sm flex items-end">
            Ausgewählt: <b className="ml-1">{recipients.length}</b>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="grid grid-cols-1 gap-3">
          <label className="text-sm">
            Betreff
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1 w-full rounded-md bg-stone-800/60 p-2 outline-none"
            />
          </label>
          <label className="text-sm">
            Nachricht (Text/HTML)
            <textarea
              rows={8}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="mt-1 w-full rounded-md bg-stone-800/60 p-2 outline-none"
            />
          </label>
          <label className="text-sm">
            Bild-URL
            <input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              className="mt-1 w-full rounded-md bg-stone-800/60 p-2 outline-none"
            />
          </label>
          <label className="text-sm">
            Prospekt (PDF) URL
            <input
              value={brochureUrl}
              onChange={(e) => setBrochureUrl(e.target.value)}
              className="mt-1 w-full rounded-md bg-stone-800/60 p-2 outline-none"
            />
          </label>

          <div className="flex flex-wrap gap-3 pt-1">
            <a
              className="btn"
              href={mailtoHref}
              target="_blank"
              rel="noreferrer"
              title="Öffnet Ihr E-Mail-Programm"
            >
              E-Mail öffnen (mailto)
            </a>
            <button className="btn" onClick={exportCSV}>
              Opt-in CSV exportieren
            </button>
          </div>

          <div className="text-xs text-stone-400">
            Hinweis: Versand erfolgt über Ihr Mail-Programm. Für einen echten Versand-Provider
            (SMTP/API) können wir später einen Server-Endpunkt integrieren.
          </div>
        </div>
      </div>
    </main>
  );
}
