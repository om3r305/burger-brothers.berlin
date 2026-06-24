"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";

type Mode = "delivery" | "pickup";

type OrderStatus =
  | "new"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "done"
  | "cancelled";

type OrderItem = {
  id?: string;
  sku?: string;
  name: string;
  category?: string;
  price: number;
  qty: number;
  add?: { label?: string; name?: string; price?: number }[];
  rm?: string[];
  note?: string;
};

type OrderRow = {
  id: string;
  orderId?: string;
  ts: number;
  createdAt?: string | null;
  mode: Mode;
  channel?: string;
  status: OrderStatus;
  plz?: string | null;
  customerName?: string;
  phone?: string;
  addressLine?: string;
  note?: string;
  items: OrderItem[];
  merchandise?: number;
  discount?: number;
  surcharges?: number;
  couponDiscount?: number;
  coupon?: string | null;
  total: number;
  customer?: any;
  meta?: any;
};

const fmtEur = (n: number) =>
  new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(Number.isFinite(n) ? n : 0);

const sum = (arr: number[]) =>
  arr.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);

function toInputDatetime(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function csvEscape(value: string) {
  return /[",;\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function num(value: any, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value == null || value === "") return fallback;

  const text = String(value).trim().replace(/[€\s]/g, "").replace(",", ".");
  const match = text.match(/-?\d+(\.\d+)?/);
  const parsed = match ? Number(match[0]) : Number(text);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function toMs(value: any, fallback = Date.now()) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (value instanceof Date && Number.isFinite(value.valueOf())) {
    return value.getTime();
  }

  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return fallback;

    const asNumber = Number(text);
    if (Number.isFinite(asNumber) && asNumber > 0) return asNumber;

    const parsed = Date.parse(text);
    if (Number.isFinite(parsed)) return parsed;
  }

  return fallback;
}

function cleanText(value: any, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function statusLabel(status: OrderStatus) {
  switch (status) {
    case "new":
      return "Eingegangen";
    case "preparing":
      return "In Vorbereitung";
    case "ready":
      return "Bereit";
    case "out_for_delivery":
      return "Unterwegs";
    case "done":
      return "Abgeschlossen";
    case "cancelled":
      return "Storniert";
  }
}

function modeLabel(mode: Mode) {
  return mode === "pickup" ? "Abholung" : "Lieferung";
}

function channelLabel(channel?: string) {
  const text = String(channel || "").toLowerCase().trim();

  if (text === "apollo" || text === "apollon" || text === "abholung") return "Apollo";
  if (text === "lieferando") return "Lieferando";
  if (text === "web") return "Web";

  return channel || "Web";
}

function normalizeStatus(value: any): OrderStatus {
  const text = String(value || "").toLowerCase().trim();

  if (text === "received" || text === "eingegangen") return "new";

  if (
    text === "prepare" ||
    text === "preparing" ||
    text === "zubereitung" ||
    text === "in_vorbereitung" ||
    text === "in vorbereitung"
  ) {
    return "preparing";
  }

  if (text === "ready" || text === "bereit" || text === "abholbereit") return "ready";
  if (text === "on_the_way" || text === "unterwegs") return "out_for_delivery";
  if (text === "delivered" || text === "completed" || text === "geliefert") return "done";
  if (text === "canceled" || text === "cancelled" || text === "storniert") return "cancelled";

  if (
    text === "new" ||
    text === "preparing" ||
    text === "ready" ||
    text === "out_for_delivery" ||
    text === "done" ||
    text === "cancelled"
  ) {
    return text;
  }

  return "new";
}

function normalizeMode(value: any): Mode {
  const text = String(value || "").toLowerCase().trim();

  if (text === "pickup" || text === "abholung" || text === "apollo" || text === "apollon") {
    return "pickup";
  }

  return "delivery";
}

function normalizeItems(value: any): OrderItem[] {
  const items = Array.isArray(value) ? value : [];

  return items.map((item, index) => ({
    id: item?.id ? String(item.id) : `${item?.sku || item?.name || "item"}-${index}`,
    sku: item?.sku ? String(item.sku) : item?.code ? String(item.code) : undefined,
    name: String(item?.name || item?.title || "Artikel"),
    category: item?.category ? String(item.category) : undefined,
    price: num(item?.price ?? item?.unitPrice, 0),
    qty: Math.max(1, num(item?.qty ?? item?.quantity ?? 1, 1)),
    add: Array.isArray(item?.add ?? item?.extras) ? item.add ?? item.extras : undefined,
    rm: Array.isArray(item?.rm ?? item?.remove)
      ? (item.rm ?? item.remove).map((entry: any) => String(entry))
      : undefined,
    note: item?.note ? String(item.note) : undefined,
  }));
}

function itemLineTotal(item: OrderItem) {
  const addSum =
    (item.add || []).reduce((total, extra) => total + num(extra?.price, 0), 0) || 0;

  return (num(item.price, 0) + addSum) * num(item.qty, 0);
}

function orderMerchandise(order: OrderRow) {
  const explicit = num(order.merchandise, 0);
  if (explicit > 0) return explicit;

  return sum((order.items || []).map(itemLineTotal));
}

function normalizeOrder(raw: any): OrderRow {
  const source =
    raw?.order && typeof raw.order === "object"
      ? raw.order
      : raw?.item && typeof raw.item === "object"
        ? raw.item
        : raw?.data && typeof raw.data === "object"
          ? raw.data
          : raw;

  const customer = source?.customer && typeof source.customer === "object" ? source.customer : {};
  const meta = source?.meta && typeof source.meta === "object" ? source.meta : {};
  const items = normalizeItems(source?.items);

  const merchandise =
    num(source?.merchandise, 0) ||
    items.reduce((total, item) => total + itemLineTotal(item), 0);

  const discount = num(source?.discount, 0);
  const surcharges = num(source?.surcharges, 0);
  const couponDiscount = num(source?.couponDiscount ?? meta?.couponDiscount, 0);

  const total = num(
    source?.total,
    Math.max(0, merchandise + surcharges - discount - couponDiscount),
  );

  const addressLine = cleanText(
    source?.addressLine ??
      customer?.addressLine ??
      customer?.address ??
      [customer?.street, customer?.house || customer?.houseNo].filter(Boolean).join(" "),
    "",
  );

  const note = cleanText(
    source?.note ??
      source?.orderNote ??
      meta?.note ??
      meta?.orderNote ??
      customer?.deliveryHint ??
      customer?.note,
    "",
  );

  return {
    id: String(source?.id || source?.orderId || ""),
    orderId: source?.orderId ? String(source.orderId) : source?.id ? String(source.id) : undefined,
    ts: toMs(source?.ts ?? source?.createdAt),
    createdAt: source?.createdAt ?? null,
    mode: normalizeMode(source?.mode),
    channel: source?.channel ? String(source.channel) : undefined,
    status: normalizeStatus(meta?.statusManual ?? source?.status),
    plz:
      source?.plz != null
        ? String(source.plz)
        : customer?.plz != null
          ? String(customer.plz)
          : customer?.zip != null
            ? String(customer.zip)
            : null,
    customerName: cleanText(source?.customerName ?? customer?.name, ""),
    phone: cleanText(source?.phone ?? customer?.phone, ""),
    addressLine,
    note,
    items,
    merchandise,
    discount,
    surcharges,
    couponDiscount,
    coupon: source?.coupon ?? meta?.coupon ?? null,
    total,
    customer,
    meta,
  };
}

async function fetchOrders(from: string, to: string) {
  const fromMs = from ? Date.parse(from) : undefined;
  const toMsValue = to ? Date.parse(to) : undefined;

  const url = new URL("/api/admin/orders", window.location.origin);

  if (Number.isFinite(fromMs)) url.searchParams.set("from", String(fromMs));
  if (Number.isFinite(toMsValue)) url.searchParams.set("to", String(toMsValue));

  url.searchParams.set("take", "1000");

  const res = await fetch(url.toString(), {
    cache: "no-store",
    headers: {
      accept: "application/json",
    },
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }

  return Array.isArray(data?.items)
    ? data.items.map(normalizeOrder).filter((order: OrderRow) => order.id)
    : Array.isArray(data?.orders)
      ? data.orders.map(normalizeOrder).filter((order: OrderRow) => order.id)
      : [];
}

function dispatchOrdersRefresh() {
  try {
    window.dispatchEvent(new CustomEvent("bb:refresh-orders"));
  } catch {}
}

export default function AdminOrdersPage() {
  const today = new Date();

  const [from, setFrom] = useState(
    toInputDatetime(startOfDay(new Date(today.getTime() - 7 * 86400000))),
  );

  const [to, setTo] = useState(toInputDatetime(endOfDay(today)));
  const [mode, setMode] = useState<"all" | Mode>("all");
  const [status, setStatus] = useState<"all" | OrderStatus>("all");
  const [plz, setPlz] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    setBusy(true);
    setError("");

    try {
      const items = await fetchOrders(from, to);
      setOrders(items);
    } catch (error) {
      console.error("admin orders load failed", error);
      setError("Bestellungen konnten nicht geladen werden.");
      setOrders([]);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const list = useMemo(() => {
    const fromTs = from ? Date.parse(from) : -Infinity;
    const toTsValue = to ? Date.parse(to) : Infinity;
    const text = q.trim().toLowerCase();
    const plzQ = plz.trim();

    return orders.filter((order) => {
      if (!(order.ts >= fromTs && order.ts <= toTsValue)) return false;
      if (mode !== "all" && order.mode !== mode) return false;
      if (status !== "all" && normalizeStatus(order.status) !== status) return false;
      if (plzQ && String(order.plz || "") !== plzQ) return false;

      if (text) {
        const header = `${order.customerName || ""} ${order.phone || ""} ${
          order.addressLine || ""
        } ${order.id || ""} ${order.channel || ""}`.toLowerCase();

        if (header.includes(text)) return true;

        return (order.items || []).some((item) =>
          String(item.name || "").toLowerCase().includes(text),
        );
      }

      return true;
    });
  }, [orders, from, to, mode, status, plz, q]);

  const kpi = useMemo(() => {
    const count = list.length;
    const revenue = sum(list.map((order) => num(order.total, 0)));
    const avg = count ? revenue / count : 0;
    const cancelled = list.filter((order) => order.status === "cancelled").length;
    const active = list.filter(
      (order) => order.status !== "done" && order.status !== "cancelled",
    ).length;

    return {
      count,
      revenue,
      avg,
      cancelled,
      active,
    };
  }, [list]);

  const setOrderStatus = async (id: string, next: OrderStatus) => {
    const prev = orders;

    try {
      setOrders((current) =>
        current.map((order) => (order.id === id ? { ...order, status: next } : order)),
      );

      const res = await fetch("/api/admin/orders", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          action: "setStatus",
          id,
          status: next,
          by: "admin",
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }

      const updated = data?.item ? normalizeOrder(data.item) : null;

      if (updated?.id) {
        setOrders((current) =>
          current.map((order) => (order.id === id ? updated : order)),
        );
      }

      dispatchOrdersRefresh();
    } catch (error) {
      console.error("status update failed", error);
      setOrders(prev);
      alert("Status konnte nicht gespeichert werden.");
    }
  };

  const duplicateOrder = async (id: string) => {
    try {
      const res = await fetch("/api/admin/orders", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          action: "duplicate",
          id,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }

      dispatchOrdersRefresh();
      await load();
    } catch (error) {
      console.error("duplicate order failed", error);
      alert("Bestellung konnte nicht dupliziert werden.");
    }
  };

  const deleteOrder = async (id: string) => {
    const ok = window.confirm("Diese Bestellung wirklich löschen?");

    if (!ok) return;

    const prev = orders;

    try {
      setOrders((current) => current.filter((order) => order.id !== id));

      const res = await fetch(`/api/admin/orders?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: {
          accept: "application/json",
        },
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }

      dispatchOrdersRefresh();
    } catch (error) {
      console.error("delete order failed", error);
      setOrders(prev);
      alert("Bestellung konnte nicht gelöscht werden.");
    }
  };

  const exportJSON = () => {
    try {
      const blob = new Blob([JSON.stringify(list, null, 2)], {
        type: "application/json",
      });

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");

      anchor.href = url;
      anchor.download = "orders.json";
      anchor.click();

      URL.revokeObjectURL(url);
    } catch {}
  };

  const exportCSV = () => {
    try {
      const header =
        "order_id;datetime;mode;channel;status;plz;customer;phone;address;item;category;qty;unit_price;line_total;order_total\n";

      const lines: string[] = [];

      for (const order of list) {
        const date = new Date(order.ts).toISOString();

        if (!order.items?.length) {
          lines.push(
            [
              order.id,
              date,
              order.mode,
              order.channel || "",
              order.status || "",
              order.plz || "",
              order.customerName || "",
              order.phone || "",
              order.addressLine || "",
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
            (item.add || []).reduce((total, extra) => total + num(extra?.price, 0), 0) || 0;

          const unit = num(item.price, 0) + addSum;
          const lineTotal = unit * num(item.qty, 0);

          lines.push(
            [
              order.id,
              date,
              order.mode,
              order.channel || "",
              order.status || "",
              order.plz || "",
              order.customerName || "",
              order.phone || "",
              order.addressLine || "",
              item.name || "",
              (item.category || "").toString(),
              String(item.qty || 0).replace(".", ","),
              unit.toFixed(2).replace(".", ","),
              lineTotal.toFixed(2).replace(".", ","),
              num(order.total, 0).toFixed(2).replace(".", ","),
            ]
              .map(csvEscape)
              .join(";"),
          );
        }
      }

      const blob = new Blob([header + lines.join("\n")], {
        type: "text/csv;charset=utf-8",
      });

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");

      anchor.href = url;
      anchor.download = "orders.csv";
      anchor.click();

      URL.revokeObjectURL(url);
    } catch {}
  };

  const onImport = async (_event: ChangeEvent<HTMLInputElement>) => {
    alert("Import ist deaktiviert: Bestellungen kommen aus der Datenbank.");
  };

  return (
    <main className="mx-auto max-w-7xl p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold">Bestellungen</h1>

          <Link href="/admin" className="text-sm text-stone-300 hover:text-stone-100">
            ← Admin
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-ghost" onClick={load} disabled={busy}>
            {busy ? "Laden…" : "Aktualisieren"}
          </button>

          <button className="btn-ghost" onClick={exportJSON}>
            JSON exportieren
          </button>

          <button className="btn-ghost" onClick={exportCSV}>
            CSV exportieren
          </button>

          <label className="btn-ghost cursor-pointer opacity-50" title="Deaktiviert">
            Import
            <input type="file" accept="application/json,.json" hidden onChange={onImport} />
          </label>
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <KPI title="Bestellungen" value={String(kpi.count)} />
        <KPI title="Aktiv" value={String(kpi.active)} />
        <KPI title="Umsatz" value={fmtEur(kpi.revenue)} />
        <KPI title="Ø Warenkorb" value={fmtEur(kpi.avg)} />
        <KPI title="Storniert" value={String(kpi.cancelled)} />
      </div>

      <div className="card mb-6">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Von">
            <input
              type="datetime-local"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
            />
          </Field>

          <Field label="Bis">
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
              <option value="delivery">Lieferung</option>
              <option value="pickup">Abholung</option>
            </select>
          </Field>

          <Field label="Status">
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as any)}
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
            >
              <option value="all">Alle</option>
              <option value="new">Eingegangen</option>
              <option value="preparing">In Vorbereitung</option>
              <option value="ready">Bereit</option>
              <option value="out_for_delivery">Unterwegs</option>
              <option value="done">Abgeschlossen</option>
              <option value="cancelled">Storniert</option>
            </select>
          </Field>

          <Field label="PLZ">
            <input
              value={plz}
              onChange={(event) => setPlz(event.target.value)}
              placeholder="z.B. 13507"
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
            />
          </Field>

          <Field label="Suche">
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Name, Telefon, Adresse, Artikel…"
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
            />
          </Field>
        </div>

        <div className="mt-3 flex items-center justify-end gap-2">
          <button className="btn" onClick={load} disabled={busy}>
            Anwenden
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {list.map((order) => {
          const isOpen = expanded === order.id;
          const date = new Date(order.ts).toLocaleString("de-DE");
          const title = `${modeLabel(order.mode)} · ${date}`;
          const merchandise = orderMerchandise(order);

          return (
            <div key={order.id} className="card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm opacity-70">#{order.id}</div>
                  <div className="text-lg font-semibold">{title}</div>

                  <div className="text-sm opacity-80">
                    {order.customerName || "—"}
                    {order.phone ? ` · ${order.phone}` : ""}
                    {order.plz ? ` · ${order.plz}` : ""}
                    {order.channel ? ` · ${channelLabel(order.channel)}` : ""}
                  </div>

                  {order.addressLine ? (
                    <div className="text-sm opacity-70">{order.addressLine}</div>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={order.status || "new"}
                    onChange={(event) =>
                      setOrderStatus(order.id, event.target.value as OrderStatus)
                    }
                    className="rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 text-sm outline-none"
                    title="Status ändern"
                  >
                    <option value="new">Eingegangen</option>
                    <option value="preparing">In Vorbereitung</option>
                    <option value="ready">Bereit</option>
                    <option value="out_for_delivery">Unterwegs</option>
                    <option value="done">Abgeschlossen</option>
                    <option value="cancelled">Storniert</option>
                  </select>

                  <button
                    className="btn-ghost"
                    onClick={() => setExpanded(isOpen ? null : order.id)}
                  >
                    {isOpen ? "Zuklappen" : "Details"}
                  </button>

                  <Link
                    className="btn-ghost"
                    href={`/admin/print?id=${encodeURIComponent(order.id)}&type=kitchen`}
                  >
                    Küche
                  </Link>

                  <Link
                    className="btn-ghost"
                    href={`/admin/print?id=${encodeURIComponent(order.id)}&type=driver`}
                  >
                    Fahrer
                  </Link>

                  <Link
                    className="btn-ghost"
                    href={`/admin/print?id=${encodeURIComponent(order.id)}&type=full`}
                  >
                    Komplett
                  </Link>

                  <button className="btn-ghost" onClick={() => duplicateOrder(order.id)}>
                    Duplizieren
                  </button>

                  <button
                    className="btn-ghost text-rose-200 hover:text-rose-100"
                    onClick={() => deleteOrder(order.id)}
                  >
                    Löschen
                  </button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm opacity-80">
                  Status: {statusLabel(order.status || "new")}
                </div>

                <div className="text-lg font-bold">{fmtEur(num(order.total, 0))}</div>
              </div>

              {isOpen ? (
                <div className="mt-4 border-t border-stone-800/70 pt-4">
                  {order.note ? <div className="mb-3 text-sm">📝 {order.note}</div> : null}

                  <div className="space-y-2">
                    {(order.items || []).map((item, index) => {
                      const addSum =
                        (item.add || []).reduce(
                          (total, extra) => total + num(extra?.price, 0),
                          0,
                        ) || 0;

                      const unit = num(item.price, 0) + addSum;

                      return (
                        <div
                          key={`${item.id || item.name}-${index}`}
                          className="flex items-start justify-between gap-3"
                        >
                          <div>
                            <div className="font-semibold">
                              {item.name} × {item.qty}
                            </div>

                            {item.add?.length || item.rm?.length || item.note ? (
                              <div className="text-xs opacity-70">
                                {item.add?.length
                                  ? `Extras: ${item.add
                                      .map((extra) => extra.label || extra.name)
                                      .filter(Boolean)
                                      .join(", ")}`
                                  : ""}

                                {item.rm?.length ? ` Ohne: ${item.rm.join(", ")}` : ""}
                                {item.note ? ` · ${item.note}` : ""}
                              </div>
                            ) : null}
                          </div>

                          <div className="text-sm opacity-80">
                            {fmtEur(unit * num(item.qty, 0))}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-4 border-t border-stone-800/70 pt-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span>Warenwert</span>
                      <b>{fmtEur(merchandise)}</b>
                    </div>

                    {num(order.surcharges, 0) > 0 ? (
                      <div className="flex items-center justify-between">
                        <span>Aufschläge</span>
                        <b>{fmtEur(num(order.surcharges, 0))}</b>
                      </div>
                    ) : null}

                    {num(order.discount, 0) > 0 ? (
                      <div className="flex items-center justify-between">
                        <span>Rabatt</span>
                        <b>-{fmtEur(num(order.discount, 0))}</b>
                      </div>
                    ) : null}

                    {num(order.couponDiscount, 0) > 0 ? (
                      <div className="flex items-center justify-between">
                        <span>Gutschein{order.coupon ? ` (${order.coupon})` : ""}</span>
                        <b>-{fmtEur(num(order.couponDiscount, 0))}</b>
                      </div>
                    ) : null}

                    <div className="mt-1 flex items-center justify-between text-base">
                      <span>Gesamt</span>
                      <b>{fmtEur(num(order.total, 0))}</b>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}

        {!list.length ? (
          <div className="py-10 text-center opacity-70">
            Keine Bestellungen gefunden.
          </div>
        ) : null}
      </div>
    </main>
  );
}

function KPI({ title, value }: { title: string; value: string }) {
  return (
    <div className="card">
      <div className="text-xs opacity-70">{title}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs opacity-70">{label}</div>
      {children}
    </label>
  );
}