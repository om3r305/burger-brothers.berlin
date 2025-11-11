// app/admin/stats/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, ChangeEvent } from "react";

/* =========================
 * Types (robust/flexible)
 * ========================= */
type Mode = "delivery" | "pickup";
type Category = "burger" | "vegan" | "extras" | "sauces" | "drinks" | "hotdogs";

type OrderItem = {
  id?: string;
  sku?: string;
  name: string;
  category?: Category | string;
  price: number; // unit price (optionally pre-discount)
  qty: number;
  add?: { label?: string; name?: string; price?: number }[];
};

type OrderLog = {
  id: string;
  ts: number; // epoch ms
  mode: Mode; // "delivery" | "pickup"
  plz?: string | null;
  items: OrderItem[];
  merchandise?: number; // subtotal
  discount?: number; // total discount
  surcharges?: number; // delivery fee etc.
  total: number; // paid total
};

/** Optional: simple visitor ping structure collected via /api/analytics/collect (or elsewhere) */
type VisitorPing = {
  ts: number;         // epoch ms
  path?: string;      // visited path, e.g. "/menu"
  sessionId?: string; // if you set one on the client
};

/* =========================
 * LocalStorage keys
 * ========================= */
const LS_ORDERS   = "bb_orders_v1";
const LS_VISITORS = "bb_visitors_v1"; // optional, if you log pageviews locally

/* =========================
 * Utils
 * ========================= */
const fmtEur = (n: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);

const rid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto
    ? (crypto as any).randomUUID()
    : String(Date.now() + Math.random()));

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function csvEscape(s: string) {
  const needs = /[",;\n]/.test(s);
  return needs ? `"${s.replace(/"/g, '""')}"` : s;
}

function sum(arr: number[]) {
  return arr.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
}

function toInputDatetime(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

/* =========================
 * Component
 * ========================= */
export default function AdminStatsPage() {
  const [orders, setOrders] = useState<OrderLog[]>([]);
  const [visitors, setVisitors] = useState<VisitorPing[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Filters
  const today = new Date();
  const defaultFrom = useRef(
    toInputDatetime(startOfDay(new Date(today.getTime() - 6 * 86400000))) // last 7 days
  );
  const defaultTo = useRef(toInputDatetime(endOfDay(today)));

  const [from, setFrom] = useState<string>(defaultFrom.current);
  const [to, setTo] = useState<string>(defaultTo.current);
  const [mode, setMode] = useState<"all" | Mode>("all");
  const [cat, setCat] = useState<"all" | Category>("all");
  const [q, setQ] = useState(""); // product search (within orders)
  const [pathFilter, setPathFilter] = useState<string>("all"); // visitor path filter

  /* ---- Load from LS ---- */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_ORDERS);
      const arr = raw ? (JSON.parse(raw) as any[]) : [];
      const safe = normalizeOrders(arr);
      setOrders(safe);
    } catch {
      setOrders([]);
    }

    try {
      const rawV = localStorage.getItem(LS_VISITORS);
      const arrV = rawV ? (JSON.parse(rawV) as any[]) : [];
      const safeV = normalizeVisitors(arrV);
      setVisitors(safeV);
    } catch {
      setVisitors([]);
    }

    setLoaded(true);
  }, []);

  /* ---- filtered orders ---- */
  const filtered = useMemo(() => {
    const fromTs = from ? Date.parse(from) : -Infinity;
    const toTs = to ? Date.parse(to) : Infinity;
    const text = q.trim().toLowerCase();

    return orders.filter((o) => {
      if (!(o.ts >= fromTs && o.ts <= toTs)) return false;
      if (mode !== "all" && o.mode !== mode) return false;
      if (cat !== "all") {
        // at least one line of that category?
        if (!o.items?.some((it) => (it.category || "").toString() === cat)) return false;
      }
      if (text) {
        const hit = o.items?.some((it) =>
          (it.name || "").toString().toLowerCase().includes(text)
        );
        if (!hit) return false;
      }
      return true;
    });
  }, [orders, from, to, mode, cat, q]);

  /* ---- filtered visitors ---- */
  const filteredVisitors = useMemo(() => {
    const fromTs = from ? Date.parse(from) : -Infinity;
    const toTs = to ? Date.parse(to) : Infinity;
    return visitors.filter((v) => {
      if (!(v.ts >= fromTs && v.ts <= toTs)) return false;
      if (pathFilter !== "all" && (v.path || "—") !== pathFilter) return false;
      return true;
    });
  }, [visitors, from, to, pathFilter]);

  /* ---- KPIs ---- */
  const kpi = useMemo(() => {
    const count = filtered.length;
    const revenue = sum(filtered.map((o) => o.total));
    const merch = sum(filtered.map((o) => o.merchandise ?? 0));
    const discount = sum(filtered.map((o) => o.discount ?? 0));
    const surcharges = sum(filtered.map((o) => o.surcharges ?? 0));
    const avg = count ? revenue / count : 0;
    const itemCount = sum(
      filtered.map((o) => sum(o.items?.map((it) => it.qty || 0) || []))
    );

    // Visitors KPIs
    const visits = filteredVisitors.length;
    // If you log a sessionId per user session, you can estimate sessions and unique sessions here.
    const uniqueSessions = new Set(
      filteredVisitors.map((v) => v.sessionId || `${new Date(v.ts).toDateString()}-${v.path || ""}`)
    ).size;

    return {
      count,
      revenue,
      merch,
      discount,
      surcharges,
      avg,
      itemCount,
      visits,
      uniqueSessions,
    };
  }, [filtered, filteredVisitors]);

  /* ---- product & category breakdown ---- */
  const byProduct = useMemo(() => {
    const map = new Map<
      string,
      { name: string; category: string; qty: number; revenue: number }
    >();
    for (const o of filtered) {
      for (const it of o.items || []) {
        const key = (it.sku || it.id || it.name || "") + "|" + (it.category || "");
        if (!map.has(key)) {
          map.set(key, {
            name: it.name || "Artikel",
            category: (it.category || "").toString(),
            qty: 0,
            revenue: 0,
          });
        }
        const row = map.get(key)!;
        row.qty += Number(it.qty || 0);
        const addSum =
          (it.add || []).reduce((a, b) => a + (Number(b?.price) || 0), 0) || 0;
        row.revenue += (Number(it.price) + addSum) * Number(it.qty || 0);
      }
    }
    const arr = Array.from(map.values());
    arr.sort((a, b) => b.qty - a.qty || b.revenue - a.revenue || a.name.localeCompare(b.name));
    return arr;
  }, [filtered]);

  const byCategory = useMemo(() => {
    const catMap = new Map<string, { qty: number; revenue: number }>();
    for (const o of filtered) {
      for (const it of o.items || []) {
        const c = (it.category || "other").toString();
        if (!catMap.has(c)) catMap.set(c, { qty: 0, revenue: 0 });
        const r = catMap.get(c)!;
        r.qty += Number(it.qty || 0);
        const addSum =
          (it.add || []).reduce((a, b) => a + (Number(b?.price) || 0), 0) || 0;
        r.revenue += (Number(it.price) + addSum) * Number(it.qty || 0);
      }
    }
    const arr = Array.from(catMap.entries()).map(([category, v]) => ({
      category,
      qty: v.qty,
      revenue: v.revenue,
    }));
    arr.sort((a, b) => b.revenue - a.revenue || b.qty - a.qty);
    return arr;
  }, [filtered]);

  /* ---- hour distribution (0–23) ---- */
  const byHour = useMemo(() => {
    const hours = Array.from({ length: 24 }, () => ({ count: 0, revenue: 0 }));
    for (const o of filtered) {
      const h = new Date(o.ts).getHours();
      hours[h].count += 1;
      hours[h].revenue += o.total;
    }
    return hours;
  }, [filtered]);

  /* ---- PLZ distribution ---- */
  const byPLZ = useMemo(() => {
    const map = new Map<string, { count: number; revenue: number }>();
    for (const o of filtered) {
      const key = (o.plz || "—").toString();
      if (!map.has(key)) map.set(key, { count: 0, revenue: 0 });
      const r = map.get(key)!;
      r.count += 1;
      r.revenue += o.total;
    }
    const arr = Array.from(map.entries()).map(([plz, v]) => ({
      plz,
      count: v.count,
      revenue: v.revenue,
    }));
    arr.sort((a, b) => b.revenue - a.revenue || b.count - a.count || a.plz.localeCompare(b.plz));
    return arr;
  }, [filtered]);

  /* ---- Visitors by hour & by path ---- */
  const visitorsByHour = useMemo(() => {
    const hours = Array.from({ length: 24 }, () => 0);
    for (const v of filteredVisitors) {
      const h = new Date(v.ts).getHours();
      hours[h] += 1;
    }
    return hours;
  }, [filteredVisitors]);

  const allPaths = useMemo(() => {
    const set = new Set<string>();
    visitors.forEach((v) => set.add(v.path || "—"));
    return ["all", ...Array.from(set)];
  }, [visitors]);

  const visitorsByPath = useMemo(() => {
    const map = new Map<string, number>();
    for (const v of filteredVisitors) {
      const k = v.path || "—";
      map.set(k, (map.get(k) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path));
  }, [filteredVisitors]);

  /* ---- EXPORTS ---- */
  const exportOrdersJSON = () => {
    try {
      const blob = new Blob([JSON.stringify(filtered, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "orders-filtered.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch {}
  };

  const exportOrdersCSV = () => {
    try {
      const header =
        "order_id;datetime;mode;plz;item;category;qty;unit_price;line_total;order_total\n";
      const lines: string[] = [];
      for (const o of filtered) {
        const dt = new Date(o.ts).toISOString();
        if (!o.items?.length) {
          lines.push(
            [
              o.id,
              dt,
              o.mode,
              o.plz || "",
              "",
              "",
              "0",
              "0",
              "0",
              String(o.total).replace(".", ","),
            ]
              .map(csvEscape)
              .join(";")
          );
          continue;
        }
        for (const it of o.items) {
          const addSum =
            (it.add || []).reduce((a, b) => a + (Number(b?.price) || 0), 0) || 0;
          const unit = Number(it.price) + addSum;
          const lt = unit * Number(it.qty || 0);
          lines.push(
            [
              o.id,
              dt,
              o.mode,
              o.plz || "",
              it.name || "",
              (it.category || "").toString(),
              String(it.qty || 0).replace(".", ","),
              unit.toFixed(2).replace(".", ","),
              lt.toFixed(2).replace(".", ","),
              o.total.toFixed(2).replace(".", ","),
            ]
              .map(csvEscape)
              .join(";")
          );
        }
      }
      const blob = new Blob([header + lines.join("\n")], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "orders-filtered.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch {}
  };

  const exportVisitorsJSON = () => {
    try {
      const blob = new Blob([JSON.stringify(filteredVisitors, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "visitors-filtered.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch {}
  };

  /* ---- IMPORT ---- */
  const onImportOrders = async (ev: ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    try {
      const txt = await f.text();
      const arr = JSON.parse(txt) as any[];
      const safe = normalizeOrders(arr);
      try {
        localStorage.setItem(LS_ORDERS, JSON.stringify(safe));
      } catch {}
      setOrders(safe);
      ev.target.value = "";
      alert(`Import OK ✅\nDatensätze: ${safe.length}`);
    } catch (e: any) {
      ev.target.value = "";
      alert("Import-Fehler. Ungültige JSON.\n" + (e?.message || ""));
    }
  };

  const onImportVisitors = async (ev: ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    try {
      const txt = await f.text();
      const arr = JSON.parse(txt) as any[];
      const safe = normalizeVisitors(arr);
      try {
        localStorage.setItem(LS_VISITORS, JSON.stringify(safe));
      } catch {}
      setVisitors(safe);
      ev.target.value = "";
      alert(`Import OK ✅\nBesucher-Pings: ${safe.length}`);
    } catch (e: any) {
      ev.target.value = "";
      alert("Import-Fehler. Ungültige JSON.\n" + (e?.message || ""));
    }
  };

  /* ---- Reset filters ---- */
  const resetFilters = () => {
    setFrom(defaultFrom.current);
    setTo(defaultTo.current);
    setMode("all");
    setCat("all");
    setQ("");
    setPathFilter("all");
  };

  return (
    <main className="mx-auto max-w-7xl p-6">
      {/* HEADER */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold">Statistiken</h1>
          <Link href="/admin" className="text-sm text-stone-300 hover:text-stone-100">
            ← Admin
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-ghost" onClick={exportOrdersJSON}>
            Bestellungen: JSON
          </button>
          <button className="btn-ghost" onClick={exportOrdersCSV}>
            Bestellungen: CSV
          </button>
          <label className="btn-ghost cursor-pointer">
            Bestellungen importieren
            <input type="file" accept="application/json,.json" hidden onChange={onImportOrders} />
          </label>

          <button className="btn-ghost" onClick={exportVisitorsJSON}>
            Besucher: JSON
          </button>
          <label className="btn-ghost cursor-pointer">
            Besucher importieren
            <input type="file" accept="application/json,.json" hidden onChange={onImportVisitors} />
          </label>
        </div>
      </div>

      {/* FILTER BAR */}
      <div className="card mb-6">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Start">
            <input
              type="datetime-local"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
            />
          </Field>
          <Field label="Ende">
            <input
              type="datetime-local"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
            />
          </Field>
          <Field label="Modus">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as any)}
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
            >
              <option value="all">Alle</option>
              <option value="delivery">Liefern</option>
              <option value="pickup">Abholen</option>
            </select>
          </Field>

          <Field label="Etageegorie">
            <select
              value={cat}
              onChange={(e) => setCat(e.target.value as any)}
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
            >
              <option value="all">Alle</option>
              <option value="burger">Burger</option>
              <option value="vegan">Vegan / Vegetarisch</option>
              <option value="extras">Extras</option>
              <option value="sauces">Soßen</option>
              <option value="drinks">Getränke</option>
              <option value="hotdogs">Hot Dogs</option>
            </select>
          </Field>

          <Field label="Produktsuche">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="z. B. Big Daddy"
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
            />
          </Field>

          <Field label="Seite (Besucher)">
            <select
              value={pathFilter}
              onChange={(e) => setPathFilter(e.target.value)}
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
            >
              {allPaths.map((p) => (
                <option key={p} value={p}>
                  {p === "all" ? "Alle Seiten" : p}
                </option>
              ))}
            </select>
          </Field>

          <div className="flex items-end">
            <button className="btn-ghost w-full" onClick={resetFilters}>
              Filter zurücksetzen
            </button>
          </div>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <KPI title="Bestellungen" value={String(kpi.count)} />
        <KPI title="Umsatz (Gesamt)" value={fmtEur(kpi.revenue)} />
        <KPI title="Warenwert" value={fmtEur(kpi.merch)} />
        <KPI title="Rabatt" value={fmtEur(kpi.discount)} />
        <KPI title="Aufschläge" value={fmtEur(kpi.surcharges)} />
        <KPI title="Ø Warenkorb" value={fmtEur(kpi.avg)} />
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <KPI title="Artikel gesamt" value={String(kpi.itemCount)} />
        <KPI title="Besucher (Pings)" value={String(kpi.visits)} />
        <KPI title="Eindeutige Sessions*" value={String(kpi.uniqueSessions)} />
      </div>
      <div className="mt-1 text-xs text-stone-400">
        *Wenn ein <code>sessionId</code> mitgeloggt wird; sonst Schätzung.
      </div>

      {/* TABLES */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top-Produkte */}
        <div className="card">
          <div className="mb-3 text-lg font-medium">Top-Produkte</div>
          <Table
            headers={["Produkt", "Etageegorie", "Menge", "Umsatz"]}
            rows={byProduct.slice(0, 20).map((r) => [
              r.name,
              r.category || "—",
              String(r.qty),
              fmtEur(r.revenue),
            ])}
            empty="Keine Daten."
          />
        </div>

        {/* Etageegorien */}
        <div className="card">
          <div className="mb-3 text-lg font-medium">Etageegorie-Breakdown</div>
          <Table
            headers={["Etageegorie", "Menge", "Umsatz"]}
            rows={byCategory.map((r) => [r.category, String(r.qty), fmtEur(r.revenue)])}
            empty="Keine Daten."
          />
        </div>

        {/* Bestellungen nach Stunde */}
        <div className="card">
          <div className="mb-3 text-lg font-medium">Bestellungen nach Stunde (0–23)</div>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="[&>th]:px-3 [&>th]:py-2 text-left">
                  {Array.from({ length: 24 }, (_, i) => (
                    <th key={i}>{i}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="[&>td]:px-3 [&>td]:py-2">
                  {byHour.map((h, i) => (
                    <td key={i} title={`Anzahl: ${h.count} • Umsatz: ${fmtEur(h.revenue)}`}>
                      {h.count}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-xs text-stone-400">
            Zelle zeigt Anzahl; Tooltip zeigt Umsatz.
          </div>
        </div>

        {/* Besucher nach Stunde */}
        <div className="card">
          <div className="mb-3 text-lg font-medium">Besucher nach Stunde (0–23)</div>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="[&>th]:px-3 [&>th]:py-2 text-left">
                  {Array.from({ length: 24 }, (_, i) => (
                    <th key={i}>{i}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="[&>td]:px-3 [&>td]:py-2">
                  {visitorsByHour.map((n, i) => (
                    <td key={i} title={`Pings: ${n}`}>{n}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-xs text-stone-400">
            Ein „Ping“ = ein geloggter Seitenaufruf im gewählten Zeitraum/Path-Filter.
          </div>
        </div>

        {/* PLZ */}
        <div className="card">
          <div className="mb-3 text-lg font-medium">PLZ-Verteilung</div>
          <Table
            headers={["PLZ", "Bestellungen", "Umsatz"]}
            rows={byPLZ.map((r) => [r.plz, String(r.count), fmtEur(r.revenue)])}
            empty="Keine Daten."
          />
        </div>

        {/* Besucher nach Seite */}
        <div className="card">
          <div className="mb-3 text-lg font-medium">Besucher nach Seite</div>
          <Table
            headers={["Seite", "Pings"]}
            rows={visitorsByPath.map((r) => [r.path, String(r.count)])}
            empty="Keine Daten."
          />
        </div>
      </div>

      {/* INFO: Schemas */}
      <div className="mt-6 rounded-xl border border-stone-700/60 bg-stone-900/60 p-4 text-sm text-stone-300">
        <div className="mb-1 font-medium">Datenschema (Info)</div>
        <pre className="whitespace-pre-wrap text-xs text-stone-400">
{`OrderLog {
  id: string,
  ts: number (epoch ms),
  mode: "delivery" | "pickup",
  plz?: string | null,
  merchandise?: number,
  discount?: number,
  surcharges?: number,
  total: number,
  items: Array<{
    name: string,
    category?: "burger"|"vegan"|"extras"|"sauces"|"drinks"|"hotdogs"|string,
    price: number,
    qty: number,
    add?: Array<{ label?: string, price?: number }>
  }>
}

VisitorPing {
  ts: number (epoch ms),
  path?: string,         // z. B. "/menu"
  sessionId?: string     // optional: für eindeutige Sessions
}`}
        </pre>
      </div>
    </main>
  );
}

/* =========================
 * Helpers (UI & data)
 * ========================= */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-stone-300/80">{label}</span>
      {children}
    </label>
  );
}

function KPI({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-stone-700/60 bg-stone-900/60 p-4">
      <div className="text-xs uppercase tracking-wide text-stone-400">{title}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}

function Table({
  headers,
  rows,
  empty,
}: {
  headers: string[];
  rows: (string | number)[][];
  empty: string;
}) {
  return rows.length === 0 ? (
    <div className="text-sm opacity-70">{empty}</div>
  ) : (
    <div className="overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-stone-900/80 backdrop-blur">
          <tr className="[&>th]:px-3 [&>th]:py-2 text-left">
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-stone-800/60">
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2">
                  {c as any}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function normalizeOrders(arr: any[]): OrderLog[] {
  if (!Array.isArray(arr)) return [];
  const safe: OrderLog[] = [];
  for (const raw of arr) {
    try {
      const id = raw?.id ? String(raw.id) : rid();
      const ts = Number(raw?.ts) || Date.now();
      const mode: Mode = raw?.mode === "pickup" ? "pickup" : "delivery";
      const plz = raw?.plz ? String(raw.plz) : null;
      const itemsArr: any[] = Array.isArray(raw?.items) ? raw.items : [];
      const items: OrderItem[] = itemsArr.map((it: any) => ({
        id: it?.id ? String(it.id) : undefined,
        sku: it?.sku ? String(it.sku) : undefined,
        name: String(it?.name ?? "Artikel"),
        category: it?.category ? String(it.category) : undefined,
        price: Number(it?.price) || 0,
        qty: Number(it?.qty) || 0,
        add: Array.isArray(it?.add)
          ? it.add.map((a: any) => ({
              label: a?.label ? String(a.label) : a?.name ? String(a.name) : undefined,
              name: a?.name ? String(a.name) : undefined,
              price: Number(a?.price) || 0,
            }))
          : undefined,
      }));
      const merchandise = Number(raw?.merchandise);
      const discount = Number(raw?.discount);
      const surcharges = Number(raw?.surcharges);
      const total = Number(raw?.total) || sum(items.map((i) => (i.price || 0) * (i.qty || 0)));

      safe.push({
        id,
        ts,
        mode,
        plz,
        items,
        merchandise: Number.isFinite(merchandise) ? merchandise : undefined,
        discount: Number.isFinite(discount) ? discount : undefined,
        surcharges: Number.isFinite(surcharges) ? surcharges : undefined,
        total,
      });
    } catch {
      // skip
    }
  }
  safe.sort((a, b) => a.ts - b.ts);
  return safe;
}

function normalizeVisitors(arr: any[]): VisitorPing[] {
  if (!Array.isArray(arr)) return [];
  const safe: VisitorPing[] = [];
  for (const raw of arr) {
    try {
      const ts = Number(raw?.ts) || Date.now();
      const path = raw?.path ? String(raw.path) : undefined;
      const sessionId = raw?.sessionId ? String(raw.sessionId) : undefined;
      safe.push({ ts, path, sessionId });
    } catch {
      // skip
    }
  }
  safe.sort((a, b) => a.ts - b.ts);
  return safe;
}
