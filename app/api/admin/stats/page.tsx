// app/admin/stats/page.tsx
"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type ChangeEvent,
} from "react";

type Mode = "pickup" | "delivery";

type Category =
  | "burger"
  | "vegan"
  | "extras"
  | "sauces"
  | "drinks"
  | "hotdogs"
  | "donuts"
  | "bubbleTea";

type OrderAddon = {
  id?: string;
  name?: string;
  price?: number;
};

type OrderItem = {
  id?: string;
  sku?: string;
  name: string;
  category?: string | Category;
  qty: number;
  price: number;
  add?: OrderAddon[];
};

type OrderLog = {
  id: string;
  ts: number;
  createdAt?: string | null;
  mode: Mode;
  status?: string;
  plz?: string | null;
  merchandise?: number;
  discount?: number;
  surcharges?: number;
  total: number;
  items: OrderItem[];
  customer?: {
    name?: string;
    phone?: string;
    address?: string;
    plz?: string;
  };
};

type VisitorPing = {
  id?: string;
  ts: number;
  path?: string;
  sessionId?: string;
  userAgent?: string;
};

const API_ORDERS = "/api/admin/orders";
const API_VISITORS = "/api/admin/visitors";

const fmtEur = (n: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(
    Number.isFinite(Number(n)) ? Number(n) : 0,
  );

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

function toNumber(value: any, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value == null || value === "") return fallback;

  const text = String(value).replace(/[€\s]/g, "").replace(",", ".").trim();
  const n = Number(text);

  return Number.isFinite(n) ? n : fallback;
}

function toTimestamp(value: any, fallback = Date.now()) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (value instanceof Date && Number.isFinite(value.valueOf())) {
    return value.getTime();
  }

  if (typeof value === "string" && value.trim()) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber) && asNumber > 0) return asNumber;

    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  return fallback;
}

function normalizeMode(value: any): Mode {
  const text = String(value || "").toLowerCase().trim();

  if (text === "delivery" || text === "lieferung" || text === "lifa") return "delivery";

  return "pickup";
}

function normalizeCategory(value: any): Category {
  const text = String(value || "").toLowerCase().trim();

  if (text === "vegan") return "vegan";
  if (text === "extras" || text === "fries" || text === "pommes") return "extras";
  if (text === "sauces" || text === "sauce" || text === "soßen" || text === "sossen") {
    return "sauces";
  }
  if (text === "drinks" || text === "drink" || text === "getränke" || text === "getraenke") {
    return "drinks";
  }
  if (text === "hotdogs" || text === "hotdog" || text === "hot-dogs") return "hotdogs";
  if (text === "donuts" || text === "donut") return "donuts";
  if (text === "bubbletea" || text === "bubble-tea" || text === "bubble_tea") {
    return "bubbleTea";
  }

  return "burger";
}

function normalizeAddons(value: any): OrderAddon[] {
  const list = Array.isArray(value)
    ? value
    : Array.isArray(value?.items)
      ? value.items
      : [];

  return list
    .filter(Boolean)
    .map((row: any) => ({
      id: row?.id ? String(row.id) : undefined,
      name: row?.name ? String(row.name) : undefined,
      price: toNumber(row?.price, 0),
    }));
}

function normalizeOrderItems(value: any): OrderItem[] {
  const list = Array.isArray(value)
    ? value
    : Array.isArray(value?.items)
      ? value.items
      : [];

  return list
    .filter(Boolean)
    .map((row: any) => {
      const qty = Math.max(0, Math.trunc(toNumber(row?.qty ?? row?.quantity ?? 1, 1)));
      const price = toNumber(row?.price ?? row?.unitPrice ?? row?.basePrice, 0);

      return {
        id: row?.id ? String(row.id) : undefined,
        sku: row?.sku ? String(row.sku) : row?.code ? String(row.code) : undefined,
        name: String(row?.name ?? row?.title ?? "Artikel"),
        category: normalizeCategory(row?.category),
        qty,
        price,
        add: normalizeAddons(row?.add ?? row?.addons ?? row?.extras),
      };
    });
}

function unwrapOrder(row: any) {
  if (row?.order && typeof row.order === "object") return row.order;
  if (row?.item && typeof row.item === "object") return row.item;
  if (row?.data && typeof row.data === "object" && !Array.isArray(row.data)) return row.data;
  return row;
}

function normalizeOrder(row: any): OrderLog | null {
  const source = unwrapOrder(row);
  if (!source || typeof source !== "object") return null;

  const id = String(source.id ?? source.orderId ?? source.code ?? "").trim();
  if (!id) return null;

  const ts = toTimestamp(source.ts ?? source.createdAt ?? source.date ?? source.meta?.ts);
  const totals = source.totals && typeof source.totals === "object" ? source.totals : {};

  const merchandise = toNumber(source.merchandise ?? totals.merchandise ?? totals.subtotal, 0);
  const discount = toNumber(source.discount ?? totals.discount ?? source.couponDiscount, 0);
  const surcharges = toNumber(source.surcharges ?? totals.surcharges ?? totals.deliveryFee, 0);
  const total = toNumber(
    source.total ?? totals.total ?? merchandise - discount + surcharges,
    0,
  );

  const customer =
    source.customer && typeof source.customer === "object" ? source.customer : {};

  return {
    id,
    ts,
    createdAt:
      typeof source.createdAt === "string"
        ? source.createdAt
        : new Date(ts).toISOString(),
    mode: normalizeMode(source.mode),
    status: String(source.status ?? source.meta?.statusManual ?? source.meta?.status ?? ""),
    plz: source.plz ?? customer.plz ?? customer.zip ?? source.meta?.plz ?? null,
    merchandise,
    discount,
    surcharges,
    total,
    items: normalizeOrderItems(source.items),
    customer: {
      name: customer.name ? String(customer.name) : undefined,
      phone: customer.phone ? String(customer.phone) : undefined,
      address: customer.address ? String(customer.address) : undefined,
      plz: customer.plz ? String(customer.plz) : undefined,
    },
  };
}

function normalizeOrders(value: any): OrderLog[] {
  const list = Array.isArray(value)
    ? value
    : Array.isArray(value?.items)
      ? value.items
      : Array.isArray(value?.orders)
        ? value.orders
        : Array.isArray(value?.allOrders)
          ? value.allOrders
          : Array.isArray(value?.data)
            ? value.data
            : [];

  return list.map(normalizeOrder).filter(Boolean) as OrderLog[];
}

function normalizeVisitor(row: any): VisitorPing | null {
  if (!row || typeof row !== "object") return null;

  const ts = toTimestamp(row.ts ?? row.createdAt ?? row.timestamp, 0);
  if (!ts) return null;

  return {
    id: row.id ? String(row.id) : undefined,
    ts,
    path: row.path ? String(row.path) : row.pathname ? String(row.pathname) : "—",
    sessionId: row.sessionId ? String(row.sessionId) : row.sid ? String(row.sid) : undefined,
    userAgent: row.userAgent ? String(row.userAgent) : undefined,
  };
}

function normalizeVisitors(value: any): VisitorPing[] {
  const list = Array.isArray(value)
    ? value
    : Array.isArray(value?.items)
      ? value.items
      : Array.isArray(value?.visitors)
        ? value.visitors
        : Array.isArray(value?.data)
          ? value.data
          : [];

  return list.map(normalizeVisitor).filter(Boolean) as VisitorPing[];
}

async function fetchOrdersAndVisitors() {
  const [ordersRes, visitorsRes] = await Promise.all([
    fetch(API_ORDERS, {
      cache: "no-store",
      headers: { accept: "application/json" },
    }),
    fetch(API_VISITORS, {
      cache: "no-store",
      headers: { accept: "application/json" },
    }).catch(() => null),
  ]);

  const ordersJson = await ordersRes.json().catch(() => ({}));

  if (!ordersRes.ok || ordersJson?.ok === false) {
    throw new Error(ordersJson?.error || "ORDERS_FETCH_FAILED");
  }

  const visitorsJson =
    visitorsRes && visitorsRes.ok ? await visitorsRes.json().catch(() => ({})) : { visitors: [] };

  return {
    orders: normalizeOrders(ordersJson),
    visitors: visitorsJson?.ok === false ? [] : normalizeVisitors(visitorsJson),
  };
}

async function importOrdersToAPI(arr: any[]): Promise<OrderLog[]> {
  const res = await fetch(API_ORDERS, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ action: "import", orders: arr }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || "IMPORT_ORDERS_FAILED");
  }

  return normalizeOrders(data);
}

async function importVisitorsToAPI(arr: any[]): Promise<VisitorPing[]> {
  const res = await fetch(API_VISITORS, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ action: "import", visitors: arr }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || "IMPORT_VISITORS_FAILED");
  }

  return normalizeVisitors(data);
}

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = filename;
  a.click();

  URL.revokeObjectURL(url);
}

export default function AdminStatsPage() {
  const [orders, setOrders] = useState<OrderLog[]>([]);
  const [visitors, setVisitors] = useState<VisitorPing[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [source, setSource] = useState<"db" | "empty">("empty");

  const today = new Date();
  const defaultFrom = useRef(
    toInputDatetime(startOfDay(new Date(today.getTime() - 6 * 86400000))),
  );
  const defaultTo = useRef(toInputDatetime(endOfDay(today)));

  const [from, setFrom] = useState<string>(defaultFrom.current);
  const [to, setTo] = useState<string>(defaultTo.current);
  const [mode, setMode] = useState<"all" | Mode>("all");
  const [cat, setCat] = useState<"all" | Category>("all");
  const [q, setQ] = useState("");
  const [pathFilter, setPathFilter] = useState<string>("all");

  async function refresh() {
    setLoaded(false);

    try {
      const data = await fetchOrdersAndVisitors();

      setOrders(data.orders);
      setVisitors(data.visitors);
      setSource("db");
    } catch {
      setOrders([]);
      setVisitors([]);
      setSource("empty");
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const data = await fetchOrdersAndVisitors();
        if (cancelled) return;

        setOrders(data.orders);
        setVisitors(data.visitors);
        setSource("db");
      } catch {
        if (!cancelled) {
          setOrders([]);
          setVisitors([]);
          setSource("empty");
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const fromTs = from ? Date.parse(from) : -Infinity;
    const toTs = to ? Date.parse(to) : Infinity;
    const text = q.trim().toLowerCase();

    return orders.filter((order) => {
      if (!(order.ts >= fromTs && order.ts <= toTs)) return false;
      if (mode !== "all" && order.mode !== mode) return false;

      if (cat !== "all") {
        if (!order.items?.some((item) => String(item.category || "") === cat)) return false;
      }

      if (text) {
        const hit = order.items?.some((item) =>
          String(item.name || "").toLowerCase().includes(text),
        );

        if (!hit) return false;
      }

      return true;
    });
  }, [orders, from, to, mode, cat, q]);

  const filteredVisitors = useMemo(() => {
    const fromTs = from ? Date.parse(from) : -Infinity;
    const toTs = to ? Date.parse(to) : Infinity;

    return visitors.filter((visitor) => {
      if (!(visitor.ts >= fromTs && visitor.ts <= toTs)) return false;
      if (pathFilter !== "all" && (visitor.path || "—") !== pathFilter) return false;
      return true;
    });
  }, [visitors, from, to, pathFilter]);

  const kpi = useMemo(() => {
    const count = filtered.length;
    const revenue = sum(filtered.map((order) => order.total));
    const merch = sum(filtered.map((order) => order.merchandise ?? 0));
    const discount = sum(filtered.map((order) => order.discount ?? 0));
    const surcharges = sum(filtered.map((order) => order.surcharges ?? 0));
    const avg = count ? revenue / count : 0;
    const itemCount = sum(
      filtered.map((order) => sum(order.items?.map((item) => item.qty || 0) || [])),
    );

    const visits = filteredVisitors.length;
    const uniqueSessions = new Set(
      filteredVisitors.map(
        (visitor) =>
          visitor.sessionId || `${new Date(visitor.ts).toDateString()}-${visitor.path || ""}`,
      ),
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

  const byProduct = useMemo(() => {
    const map = new Map<
      string,
      { name: string; category: string; qty: number; revenue: number }
    >();

    for (const order of filtered) {
      for (const item of order.items || []) {
        const key = `${item.sku || item.id || item.name || ""}|${item.category || ""}`;

        if (!map.has(key)) {
          map.set(key, {
            name: item.name || "Artikel",
            category: String(item.category || ""),
            qty: 0,
            revenue: 0,
          });
        }

        const row = map.get(key)!;
        row.qty += Number(item.qty || 0);

        const addSum =
          (item.add || []).reduce((a, b) => a + (Number(b?.price) || 0), 0) || 0;

        row.revenue += (Number(item.price) + addSum) * Number(item.qty || 0);
      }
    }

    const arr = Array.from(map.values());
    arr.sort((a, b) => b.qty - a.qty || b.revenue - a.revenue || a.name.localeCompare(b.name));
    return arr;
  }, [filtered]);

  const byCategory = useMemo(() => {
    const catMap = new Map<string, { qty: number; revenue: number }>();

    for (const order of filtered) {
      for (const item of order.items || []) {
        const c = String(item.category || "other");

        if (!catMap.has(c)) catMap.set(c, { qty: 0, revenue: 0 });

        const row = catMap.get(c)!;
        row.qty += Number(item.qty || 0);

        const addSum =
          (item.add || []).reduce((a, b) => a + (Number(b?.price) || 0), 0) || 0;

        row.revenue += (Number(item.price) + addSum) * Number(item.qty || 0);
      }
    }

    const arr = Array.from(catMap.entries()).map(([category, value]) => ({
      category,
      qty: value.qty,
      revenue: value.revenue,
    }));

    arr.sort(
      (a, b) => b.revenue - a.revenue || b.qty - a.qty || a.category.localeCompare(b.category),
    );

    return arr;
  }, [filtered]);

  const byHour = useMemo(() => {
    const hours = Array.from({ length: 24 }, () => ({ count: 0, revenue: 0 }));

    for (const order of filtered) {
      const h = new Date(order.ts).getHours();
      const row = hours[h];

      if (!row) continue;

      row.count += 1;
      row.revenue += order.total;
    }

    return hours;
  }, [filtered]);

  const byPLZ = useMemo(() => {
    const map = new Map<string, { count: number; revenue: number }>();

    for (const order of filtered) {
      const key = String(order.plz || "—");

      if (!map.has(key)) map.set(key, { count: 0, revenue: 0 });

      const row = map.get(key)!;
      row.count += 1;
      row.revenue += order.total;
    }

    const arr = Array.from(map.entries()).map(([plz, value]) => ({
      plz,
      count: value.count,
      revenue: value.revenue,
    }));

    arr.sort((a, b) => b.revenue - a.revenue || b.count - a.count || a.plz.localeCompare(b.plz));

    return arr;
  }, [filtered]);

  const visitorsByHour = useMemo(() => {
    const hours = Array.from({ length: 24 }, () => 0);

    for (const visitor of filteredVisitors) {
      const h = new Date(visitor.ts).getHours();
      hours[h] = (hours[h] || 0) + 1;
    }

    return hours;
  }, [filteredVisitors]);

  const allPaths = useMemo(() => {
    const set = new Set<string>();

    visitors.forEach((visitor) => set.add(visitor.path || "—"));

    return ["all", ...Array.from(set)];
  }, [visitors]);

  const visitorsByPath = useMemo(() => {
    const map = new Map<string, number>();

    for (const visitor of filteredVisitors) {
      const key = visitor.path || "—";
      map.set(key, (map.get(key) || 0) + 1);
    }

    return Array.from(map.entries())
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path));
  }, [filteredVisitors]);

  const exportOrdersJSON = () => {
    try {
      downloadFile(
        "orders-filtered.json",
        JSON.stringify(filtered, null, 2),
        "application/json;charset=utf-8",
      );
    } catch {}
  };

  const exportOrdersCSV = () => {
    try {
      const header =
        "order_id;datetime;mode;plz;item;category;qty;unit_price;line_total;order_total\n";

      const lines: string[] = [];

      for (const order of filtered) {
        const dt = new Date(order.ts).toISOString();

        if (!order.items?.length) {
          lines.push(
            [
              order.id,
              dt,
              order.mode,
              order.plz || "",
              "",
              "",
              "0",
              "0",
              "0",
              String(order.total).replace(".", ","),
            ]
              .map(csvEscape)
              .join(";"),
          );

          continue;
        }

        for (const item of order.items) {
          const addSum =
            (item.add || []).reduce((a, b) => a + (Number(b?.price) || 0), 0) || 0;
          const unit = Number(item.price) + addSum;
          const lineTotal = unit * Number(item.qty || 0);

          lines.push(
            [
              order.id,
              dt,
              order.mode,
              order.plz || "",
              item.name || "",
              String(item.category || ""),
              String(item.qty || 0).replace(".", ","),
              unit.toFixed(2).replace(".", ","),
              lineTotal.toFixed(2).replace(".", ","),
              order.total.toFixed(2).replace(".", ","),
            ]
              .map(csvEscape)
              .join(";"),
          );
        }
      }

      downloadFile("orders-filtered.csv", header + lines.join("\n"), "text/csv;charset=utf-8");
    } catch {}
  };

  const exportVisitorsJSON = () => {
    try {
      downloadFile(
        "visitors-filtered.json",
        JSON.stringify(filteredVisitors, null, 2),
        "application/json;charset=utf-8",
      );
    } catch {}
  };

  const onImportOrders = async (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.orders) ? parsed.orders : [];

      if (!arr.length) throw new Error("Keine Bestellungen gefunden.");

      const safe = await importOrdersToAPI(arr);

      setOrders(safe);
      ev.target.value = "";

      alert(`Import OK ✅\nDatensätze: ${safe.length}`);
    } catch (error: any) {
      ev.target.value = "";
      alert(`Import-Fehler. Ungültige JSON.\n${error?.message || ""}`);
    }
  };

  const onImportVisitors = async (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const arr = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.visitors)
          ? parsed.visitors
          : [];

      if (!arr.length) throw new Error("Keine Besucher-Pings gefunden.");

      const safe = await importVisitorsToAPI(arr);

      setVisitors(safe);
      ev.target.value = "";

      alert(`Import OK ✅\nBesucher-Pings: ${safe.length}`);
    } catch (error: any) {
      ev.target.value = "";
      alert(`Import-Fehler. Ungültige JSON.\n${error?.message || ""}`);
    }
  };

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
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold">Statistiken</h1>
          <Link href="/admin" className="text-sm text-stone-300 hover:text-stone-100">
            ← Admin
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-stone-400">
            Datenquelle:{" "}
            <b className={source === "db" ? "text-emerald-400" : "text-amber-400"}>
              {source === "db" ? "DB" : "Leer"}
            </b>
            {!loaded ? " · Lädt…" : ""}
          </span>

          <button className="btn-ghost" onClick={refresh}>
            Aktualisieren
          </button>

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

      <div className="card mb-6">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Start">
            <input
              type="datetime-local"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
            />
          </Field>

          <Field label="Ende">
            <input
              type="datetime-local"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
            />
          </Field>

          <Field label="Modus">
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value as any)}
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
            >
              <option value="all">Alle</option>
              <option value="delivery">Liefern</option>
              <option value="pickup">Abholen</option>
            </select>
          </Field>

          <Field label="Kategorie">
            <select
              value={cat}
              onChange={(event) => setCat(event.target.value as any)}
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
            >
              <option value="all">Alle</option>
              <option value="burger">Burger</option>
              <option value="vegan">Vegan / Vegetarisch</option>
              <option value="extras">Extras</option>
              <option value="sauces">Soßen</option>
              <option value="drinks">Getränke</option>
              <option value="hotdogs">Hot Dogs</option>
              <option value="donuts">Donuts</option>
              <option value="bubbleTea">Bubble Tea</option>
            </select>
          </Field>

          <Field label="Produktsuche">
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="z. B. Big Daddy"
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
            />
          </Field>

          <Field label="Seite (Besucher)">
            <select
              value={pathFilter}
              onChange={(event) => setPathFilter(event.target.value)}
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
            >
              {allPaths.map((path) => (
                <option key={path} value={path}>
                  {path === "all" ? "Alle Seiten" : path}
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

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card">
          <div className="mb-3 text-lg font-medium">Top-Produkte</div>
          <Table
            headers={["Produkt", "Kategorie", "Menge", "Umsatz"]}
            rows={byProduct.slice(0, 20).map((row) => [
              row.name,
              row.category || "—",
              String(row.qty),
              fmtEur(row.revenue),
            ])}
            empty="Keine Daten."
          />
        </div>

        <div className="card">
          <div className="mb-3 text-lg font-medium">Kategorie-Breakdown</div>
          <Table
            headers={["Kategorie", "Menge", "Umsatz"]}
            rows={byCategory.map((row) => [
              row.category,
              String(row.qty),
              fmtEur(row.revenue),
            ])}
            empty="Keine Daten."
          />
        </div>

        <div className="card">
          <div className="mb-3 text-lg font-medium">Bestellungen nach Stunde (0–23)</div>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="[&>th]:px-3 [&>th]:py-2 text-left">
                  {Array.from({ length: 24 }, (_, index) => (
                    <th key={index}>{index}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="[&>td]:px-3 [&>td]:py-2">
                  {byHour.map((hour, index) => (
                    <td
                      key={index}
                      title={`Anzahl: ${hour.count} • Umsatz: ${fmtEur(hour.revenue)}`}
                    >
                      {hour.count}
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

        <div className="card">
          <div className="mb-3 text-lg font-medium">Besucher nach Stunde (0–23)</div>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="[&>th]:px-3 [&>th]:py-2 text-left">
                  {Array.from({ length: 24 }, (_, index) => (
                    <th key={index}>{index}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="[&>td]:px-3 [&>td]:py-2">
                  {visitorsByHour.map((count, index) => (
                    <td key={index} title={`Pings: ${count}`}>
                      {count}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-xs text-stone-400">
            Ein „Ping“ = ein geloggter Seitenaufruf im gewählten Zeitraum/Path-Filter.
          </div>
        </div>

        <div className="card">
          <div className="mb-3 text-lg font-medium">PLZ-Verteilung</div>
          <Table
            headers={["PLZ", "Bestellungen", "Umsatz"]}
            rows={byPLZ.map((row) => [row.plz, String(row.count), fmtEur(row.revenue)])}
            empty="Keine Daten."
          />
        </div>

        <div className="card">
          <div className="mb-3 text-lg font-medium">Besucher nach Seite</div>
          <Table
            headers={["Seite", "Pings"]}
            rows={visitorsByPath.map((row) => [row.path, String(row.count)])}
            empty="Keine Daten."
          />
        </div>
      </div>
    </main>
  );
}

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
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-stone-800/60">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-3 py-2">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}