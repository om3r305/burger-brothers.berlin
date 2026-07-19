// app/admin/print/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "react-qr-code";
import { readSettings } from "@/lib/settings";

type PrintType = "kitchen" | "driver" | "full";

type DbOrder = {
  id: string;
  orderId?: string;
  ts: number;
  createdAt?: string | null;
  mode: "pickup" | "delivery";
  status?: string;
  planned?: string | null;
  merchandise?: number;
  discount?: number;
  surcharges?: number;
  couponDiscount?: number;
  coupon?: string | null;
  total?: number;
  customer?: any;
  customerName?: string;
  phone?: string;
  addressLine?: string;
  note?: string;
  items?: any[];
  meta?: any;
};

const fmt = (value: number) =>
  new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(Number.isFinite(value) ? value : 0);

function num(value: any, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value == null || value === "") return fallback;

  const text = String(value).trim().replace(/[€\s]/g, "").replace(",", ".");
  const match = text.match(/-?\d+(\.\d+)?/);
  const n = match ? Number(match[0]) : Number(text);

  return Number.isFinite(n) ? n : fallback;
}

function cleanText(value: any, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizePrintType(value: any): PrintType {
  const text = String(value || "").toLowerCase().trim();

  if (text === "driver" || text === "fahrer") return "driver";
  if (text === "full" || text === "komplett" || text === "complete") return "full";

  return "kitchen";
}

function printTitle(type: PrintType, mode: DbOrder["mode"]) {
  const modeText = mode === "pickup" ? "ABHOLUNG" : "LIEFERUNG";

  if (type === "kitchen") return `KÜCHE · ${modeText}`;
  if (type === "driver") return `FAHRER · ${modeText}`;

  return `KOMPLETT · ${modeText}`;
}

function statusLabel(status?: string) {
  const text = String(status || "").toLowerCase().trim();

  if (text === "new" || text === "received") return "Eingegangen";
  if (text === "preparing") return "In Vorbereitung";
  if (text === "ready") return "Bereit";
  if (text === "out_for_delivery" || text === "on_the_way") return "Unterwegs";
  if (text === "done" || text === "completed" || text === "delivered") return "Abgeschlossen";
  if (text === "cancelled" || text === "canceled") return "Storniert";

  return "Eingegangen";
}

function normalizeItems(value: any): any[] {
  return Array.isArray(value)
    ? value.map((item, index) => ({
        ...item,
        id: item?.id ? String(item.id) : `${item?.sku || item?.name || "item"}-${index}`,
        name: String(item?.name || item?.title || "Artikel"),
        category: item?.category ? String(item.category) : "diverse",
        price: num(item?.price ?? item?.unitPrice, 0),
        qty: Math.max(1, num(item?.qty ?? item?.quantity ?? 1, 1)),
        add: Array.isArray(item?.add ?? item?.extras) ? item.add ?? item.extras : [],
        rm: Array.isArray(item?.rm ?? item?.remove) ? item.rm ?? item.remove : [],
        note: item?.note ? String(item.note) : "",
      }))
    : [];
}

function normalizeOrder(raw: any): DbOrder | null {
  const source =
    raw?.order && typeof raw.order === "object"
      ? raw.order
      : raw?.item && typeof raw.item === "object"
        ? raw.item
        : raw?.data && typeof raw.data === "object"
          ? raw.data
          : raw;

  if (!source || typeof source !== "object") return null;

  const id = cleanText(source.id ?? source.orderId);
  if (!id) return null;

  const customer = source.customer && typeof source.customer === "object" ? source.customer : {};
  const meta = source.meta && typeof source.meta === "object" ? source.meta : {};
  const items = normalizeItems(source.items);

  const merchandise =
    num(source.merchandise, 0) ||
    items.reduce((sum, item) => {
      const addSum = (item.add || []).reduce(
        (total: number, extra: any) => total + num(extra?.price, 0),
        0,
      );

      return sum + (num(item.price, 0) + addSum) * num(item.qty, 1);
    }, 0);

  const discount = num(source.discount, 0);
  const surcharges = num(source.surcharges, 0);
  const couponDiscount = num(source.couponDiscount ?? meta?.couponDiscount, 0);
  const total = num(source.total, Math.max(0, merchandise + surcharges - discount - couponDiscount));

  const addressLine = cleanText(
    source.addressLine ??
      customer.addressLine ??
      customer.address ??
      [customer.street, customer.house].filter(Boolean).join(" "),
    "",
  );

  const note = cleanText(
    source.note ??
      source.orderNote ??
      meta.note ??
      meta.orderNote ??
      customer.deliveryHint ??
      customer.note,
    "",
  );

  return {
    id,
    orderId: cleanText(source.orderId, id),
    ts: num(source.ts, Date.parse(source.createdAt || "") || Date.now()),
    createdAt: source.createdAt || null,
    mode:
      String(source.mode || "").toLowerCase() === "pickup" ||
      String(source.mode || "").toLowerCase() === "abholung"
        ? "pickup"
        : "delivery",
    status: source.status,
    planned: source.planned ?? null,
    merchandise,
    discount,
    surcharges,
    couponDiscount,
    coupon: source.coupon ?? meta.coupon ?? null,
    total,
    customer: {
      ...customer,
      name: cleanText(customer.name ?? source.customerName, ""),
      phone: cleanText(customer.phone ?? source.phone, ""),
      addressLine,
      address: addressLine,
      plz: cleanText(customer.plz ?? customer.zip ?? source.plz, ""),
      deliveryHint: cleanText(customer.deliveryHint ?? customer.note ?? note, ""),
    },
    customerName: cleanText(source.customerName ?? customer.name, ""),
    phone: cleanText(source.phone ?? customer.phone, ""),
    addressLine,
    note,
    items,
    meta,
  };
}

async function fetchOrder(id: string): Promise<DbOrder | null> {
  const endpoints = [
    `/api/admin/orders?id=${encodeURIComponent(id)}`,
    `/api/orders/status?id=${encodeURIComponent(id)}`,
    `/api/track/lookup?id=${encodeURIComponent(id)}`,
  ];

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        cache: "no-store",
        headers: {
          accept: "application/json",
        },
      });

      if (!res.ok) continue;

      const data = await res.json().catch(() => null);
      const item = normalizeOrder(data);

      if (item) return item;
    } catch {}
  }

  return null;
}

function categoryLabel(category: string) {
  const key = String(category || "diverse").toLowerCase();

  if (key === "burger") return "BURGER";
  if (key === "vegan") return "VEGAN";
  if (key === "extras" || key === "fries" || key === "snacks") return "EXTRAS";
  if (key === "sauces" || key === "sauce") return "SOẞEN";
  if (key === "drinks" || key === "drink" || key === "getraenke" || key === "getränke") return "GETRÄNKE";
  if (key === "hotdogs" || key === "hotdog") return "HOTDOGS";
  if (key === "donuts" || key === "donut") return "DONUTS";
  if (key === "bubbletea" || key === "bubble-tea" || key === "bubble_tea") return "BUBBLE TEA";

  return "DIVERSE";
}

function categorySort(label: string) {
  const order = [
    "BURGER",
    "VEGAN",
    "HOTDOGS",
    "EXTRAS",
    "SOẞEN",
    "GETRÄNKE",
    "DONUTS",
    "BUBBLE TEA",
    "DIVERSE",
  ];

  const index = order.indexOf(label);
  return index >= 0 ? index : 999;
}

function itemUnit(item: any) {
  const addSum = (item.add || []).reduce(
    (total: number, extra: any) => total + num(extra?.price, 0),
    0,
  );

  return num(item.price, 0) + addSum;
}

function buildMapsLink(addressLine: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressLine)}`;
}

export default function PrintPage() {
  const [query, setQuery] = useState<{
    id: string;
    type: PrintType;
    autoPrint: boolean;
  } | null>(null);

  const [order, setOrder] = useState<DbOrder | null>(null);
  const [busy, setBusy] = useState(false);

  const settings = readSettings() as any;
  const printing = settings?.printing || {};

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    setQuery({
      id: params.get("id") || params.get("orderId") || "",
      type: normalizePrintType(params.get("type")),
      autoPrint: params.get("print") === "1" || params.get("auto") === "1",
    });
  }, []);

  useEffect(() => {
    if (!query?.id) return;

    let alive = true;

    async function load() {
      setBusy(true);

      try {
        const item = await fetchOrder(query!.id);
        if (alive) setOrder(item);
      } catch {
        if (alive) setOrder(null);
      } finally {
        if (alive) setBusy(false);
      }
    }

    load();

    return () => {
      alive = false;
    };
  }, [query?.id]);

  useEffect(() => {
    if (!query?.autoPrint || !order) return;

    const timer = window.setTimeout(() => {
      window.print();
    }, 450);

    return () => window.clearTimeout(timer);
  }, [query?.autoPrint, order]);

  const groups = useMemo(() => {
    const grouped: Record<string, any[]> = {};

    for (const item of order?.items || []) {
      const label = categoryLabel(item.category || "diverse");

      if (!grouped[label]) grouped[label] = [];
      grouped[label].push(item);
    }

    return Object.entries(grouped).sort(([a], [b]) => categorySort(a) - categorySort(b));
  }, [order]);

  if (!query) {
    return <main className="p-6">Laden…</main>;
  }

  if (!query.id) {
    return <main className="p-6">Bestellung nicht gefunden.</main>;
  }

  if (busy && !order) {
    return <main className="p-6">Laden…</main>;
  }

  if (!order) {
    return <main className="p-6">Bestellung nicht gefunden.</main>;
  }

  const type = query.type;
  const showPrices = type !== "kitchen";
  const showQr = order.mode === "delivery" && type !== "kitchen" && printing.showQR !== false;

  const customerName = cleanText(order.customer?.name ?? order.customerName, "—");
  const phone = cleanText(order.customer?.phone ?? order.phone, "—");
  const addressLine = cleanText(order.customer?.addressLine ?? order.customer?.address ?? order.addressLine, "");
  const maps = buildMapsLink(addressLine);

  const logoUrl = cleanText(printing.logoUrl, "");
  const footerNote = cleanText(printing.footerNote ?? printing.footerHinweise, "");

  return (
    <main className="mx-auto max-w-3xl bg-white p-6 text-black print:max-w-none print:p-0">
      <style jsx global>{`
        @media print {
          body {
            background: #fff !important;
            color: #000 !important;
          }

          .no-print {
            display: none !important;
          }

          main {
            width: 100%;
          }
        }
      `}</style>

      <div className="no-print mb-4 flex items-center justify-between rounded border border-stone-300 bg-stone-100 p-3 text-sm">
        <div>
          Druckansicht: <b>{printTitle(type, order.mode)}</b>
        </div>

        <button
          type="button"
          onClick={() => window.print()}
          className="rounded bg-black px-3 py-1.5 text-white"
        >
          Drucken
        </button>
      </div>

      <header className="mb-3 flex items-center justify-between border-b border-black pb-3">
        <div className="flex items-center gap-3">
          {logoUrl ? (
            <img src={logoUrl} alt="Logo" width={80} height={80} />
          ) : null}

          <div>
            <div className="text-xs opacity-70">Bestell-Nr.</div>
            <div className="text-2xl font-black">#{order.id}</div>
            <div className="text-xs opacity-70">
              {new Date(order.ts).toLocaleString("de-DE")}
            </div>
          </div>
        </div>

        <div className="text-right">
          <div className="text-2xl font-extrabold">{printTitle(type, order.mode)}</div>
          <div className="text-sm opacity-80">Status: {statusLabel(order.status)}</div>
          {order.planned ? <div className="text-sm">Geplant: {order.planned}</div> : null}
        </div>
      </header>

      <section className="mb-3 grid grid-cols-1 gap-3 border-b border-black pb-3 md:grid-cols-2 print:grid-cols-2">
        <div>
          <div className="mb-1 text-sm font-bold">Kunde</div>
          <div className="font-semibold">{customerName}</div>
          <div>{phone}</div>

          {order.mode === "delivery" ? (
            <>
              <div className="mt-1 whitespace-pre-wrap">{addressLine || "—"}</div>
              {order.customer?.plz ? <div>PLZ: {order.customer.plz}</div> : null}
            </>
          ) : null}
        </div>

        <div>
          {showQr && addressLine ? (
            <div className="flex justify-end">
              <div>
                <div
                  aria-label="Google Maps QR"
                  className="inline-flex bg-white p-1"
                >
                  <QRCode
                    value={maps}
                    size={150}
                    bgColor="#ffffff"
                    fgColor="#000000"
                    level="M"
                  />
                </div>
                <div className="mt-1 max-w-[260px] break-all text-[10px] opacity-70">
                  {maps}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm opacity-70">
              {order.mode === "pickup" ? "Abholung im Laden" : ""}
            </div>
          )}
        </div>
      </section>

      {(order.note || order.customer?.deliveryHint || order.customer?.note) ? (
        <section className="mb-3 rounded border border-black p-2">
          <div className="mb-1 text-sm font-bold">Hinweis</div>
          <div className="whitespace-pre-wrap text-sm">
            {order.note || order.customer?.deliveryHint || order.customer?.note}
          </div>
        </section>
      ) : null}

      <section className="mb-3">
        {groups.map(([category, items]) => (
          <div key={category} className="mb-3">
            <div className="border-b border-black pb-1 text-lg font-black">{category}</div>

            <div className="mt-1 space-y-2">
              {items.map((item: any, index: number) => {
                const unit = itemUnit(item);
                const line = unit * num(item.qty, 1);

                return (
                  <div key={`${item.id || item.name}-${index}`} className="break-inside-avoid">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-base font-bold">
                          {item.name} × {item.qty}
                        </div>

                        {item.add?.length ? (
                          <div className="text-xs">
                            Extras:{" "}
                            {item.add
                              .map((extra: any) => extra.label || extra.name)
                              .filter(Boolean)
                              .join(", ")}
                          </div>
                        ) : null}

                        {item.rm?.length ? (
                          <div className="text-xs">Ohne: {item.rm.join(", ")}</div>
                        ) : null}

                        {item.note ? (
                          <div className="text-xs">Hinweis: {item.note}</div>
                        ) : null}
                      </div>

                      {showPrices ? (
                        <div className="whitespace-nowrap text-sm font-semibold">
                          {fmt(line)}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      {showPrices ? (
        <section className="mt-3 border-t border-black pt-3">
          <div className="flex justify-between">
            <span>Warenwert</span>
            <b>{fmt(num(order.merchandise, 0))}</b>
          </div>

          {num(order.surcharges, 0) > 0 ? (
            <div className="flex justify-between">
              <span>Aufschläge</span>
              <b>{fmt(num(order.surcharges, 0))}</b>
            </div>
          ) : null}

          {num(order.discount, 0) > 0 ? (
            <div className="flex justify-between">
              <span>Rabatt</span>
              <b>-{fmt(num(order.discount, 0))}</b>
            </div>
          ) : null}

          {num(order.couponDiscount, 0) > 0 ? (
            <div className="flex justify-between">
              <span>Gutschein{order.coupon ? ` (${order.coupon})` : ""}</span>
              <b>-{fmt(num(order.couponDiscount, 0))}</b>
            </div>
          ) : null}

          <div className="mt-2 flex justify-between text-xl font-black">
            <span>Gesamt</span>
            <span>{fmt(num(order.total, 0))}</span>
          </div>
        </section>
      ) : null}

      {footerNote ? (
        <footer className="mt-4 border-t border-black pt-2 text-xs opacity-70">
          {footerNote}
        </footer>
      ) : null}
    </main>
  );
}
