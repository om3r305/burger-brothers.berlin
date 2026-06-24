// app/dashboard/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  readAllOrders,
  setOrderStatus,
  StoredOrder,
  OrderStatus,
} from "@/lib/orders";
import { readSettings } from "@/lib/settings";
import { useSearchParams } from "next/navigation";

/* ── Status labels (DE) ───────────────────────────────────────────── */
const statusLabel: Record<OrderStatus, string> = {
  new: "Eingegangen",
  preparing: "In Vorbereitung",
  ready: "Abholbereit",
  out_for_delivery: "Unterwegs",
  done: "Abgeschlossen",
  cancelled: "Storniert",
};

/* ── UI helpers ───────────────────────────────────────────────────── */
const metal =
  "bg-gradient-to-br from-stone-200/20 via-stone-100/10 to-stone-300/5 backdrop-blur border border-white/10";

/** Ticker (value is used to re-run effects/memos every second) */
function useTick(ms = 1000) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return t;
}

/** Resolve ETA minutes (order-specific or fallback) */
function etaFor(order: StoredOrder, fallbackPickup = 15, fallbackDelivery = 35) {
  return order.etaMin ?? (order.mode === "pickup" ? fallbackPickup : fallbackDelivery);
}

/** Remaining ms until ETA moment */
function remainingMs(order: StoredOrder, fallbackPickup = 15, fallbackDelivery = 35) {
  const eta = etaFor(order, fallbackPickup, fallbackDelivery);
  const end = (order.ts || Date.now()) + eta * 60_000;
  return end - Date.now();
}

/** Auto-status with an initial NEW grace, then phase, then auto-DONE */
function autoStatus(
  order: StoredOrder,
  _remMs: number,
  avgPickup: number,
  avgDelivery: number,
  newGraceMin: number
): OrderStatus {
  if (order.status === "done" || order.status === "cancelled") return order.status;

  const eta = etaFor(order, avgPickup, avgDelivery);
  const dur = Math.max(1, eta * 60_000);
  const start = order.ts || Date.now();
  const elapsed = Math.max(0, Date.now() - start);
  const p = Math.min(1, elapsed / dur);

  // 1) show NEW for the first X minutes
  if (elapsed < newGraceMin * 60_000) return "new";

  // 2) ETA reached → auto complete
  if (p >= 1) return "done";

  // 3) phase changes by mode
  if (order.mode === "pickup") {
    return p < 0.7 ? "preparing" : "ready";
  } else {
    return p < 0.6 ? "preparing" : "out_for_delivery";
  }
}

/** Hydration-safe clock (simple) */
function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="opacity-80">{now ? now.toLocaleString() : ""}</span>;
}

/** "PLZ • Straße • Hausnr." for delivery cards */
function prettyDeliveryAddress(addr?: string) {
  if (!addr) return "";
  // Stored like: "Street House | ZIP City | Floor • Entrance"
  const parts = addr.split("|").map((s) => s.trim());
  const streetHouse = parts[0] || "";
  const zipCity = parts[1] || "";
  const zipMatch = zipCity.match(/\b\d{5}\b/);
  const zip = zipMatch ? zipMatch[0] : zipCity;

  let street = streetHouse;
  let house = "";
  const i = streetHouse.lastIndexOf(" ");
  if (i > 0) {
    street = streetHouse.slice(0, i).trim();
    house = streetHouse.slice(i + 1).trim();
  }
  return [zip, street, house].filter(Boolean).join(" • ");
}

/* ── Page ─────────────────────────────────────────────────────────── */
export default function DashboardPage() {
  const tick = useTick(1000);
  const search = useSearchParams();
  const tvMode = (search.get("tv") ?? "") !== "" && search.get("tv") !== "0";
  const autoFs = (search.get("autofs") ?? "") !== "" && search.get("autofs") !== "0";

  const [orders, setOrders] = useState<StoredOrder[]>([]);
  const [sel, setSel] = useState<StoredOrder | null>(null);
  const [view, setView] = useState<"active" | "done">("active");
  const [autoRefresh, setAutoRefresh] = useState(true);

  const settings = readSettings() as any;
  const avgPickup = Number(settings?.hours?.avgPickupMinutes ?? 15);
  const avgDelivery = Number(settings?.hours?.avgDeliveryMinutes ?? 35);
  // default 5 minutes “Eingegangen” grace (can override via settings.hours.newGraceMinutes)
  const newGraceMin = Math.max(0, Number(settings?.hours?.newGraceMinutes ?? 5));

  const refresh = () => setOrders(readAllOrders());

  // initial
  useEffect(() => {
    refresh();
  }, []);

  // background refresh
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [autoRefresh]);

  // auto-advance every tick
  useEffect(() => {
    const next = readAllOrders().map((o) => {
      const rem = remainingMs(o, avgPickup, avgDelivery);
      const s = autoStatus(o, rem, avgPickup, avgDelivery, newGraceMin);
      if (s !== (o.status || "new")) setOrderStatus(o.id, s);
      return { ...o, status: s };
    });
    setOrders(next);
  }, [tick, avgPickup, avgDelivery, newGraceMin]);

  // today-only
  const startOfToday = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);

  const todayOrders = useMemo(() => {
    return orders.filter((o) => (o.ts ?? 0) >= startOfToday);
  }, [orders, startOfToday]);

  // tab filter
  const filtered = useMemo(() => {
    return todayOrders.filter((o) =>
      view === "active" ? o.status !== "done" && o.status !== "cancelled" : o.status === "done"
    );
  }, [todayOrders, view]);

  // columns
  const lieferungList = useMemo(() => {
    return filtered.filter((o) => o.mode === "delivery").sort((a, b) => b.ts - a.ts);
  }, [filtered]);

  const abholungList = useMemo(() => {
    return filtered.filter((o) => o.mode === "pickup").sort((a, b) => b.ts - a.ts);
  }, [filtered]);

  // top stats
  const top = useMemo(() => {
    const lieferung = todayOrders.filter((o) => o.mode === "delivery").length;
    const abholung = todayOrders.filter((o) => o.mode === "pickup").length;
    const active = todayOrders.filter((o) => o.status !== "done" && o.status !== "cancelled").length;
    const finished = todayOrders.filter((o) => o.status === "done").length;
    return { lieferung, abholung, active, finished };
  }, [todayOrders]);

  /* TV mode: attempt fullscreen & wake lock, hide scrollbars */
  useEffect(() => {
    if (!tvMode) return;

    let wakeLock: any = null;

    const tryFs = async () => {
      try {
        if (autoFs && document.fullscreenElement == null) {
          await document.documentElement.requestFullscreen();
        }
      } catch {}
    };

    const tryWake = async () => {
      try {
        // @ts-ignore
        if ("wakeLock" in navigator) {
          // @ts-ignore
          wakeLock = await navigator.wakeLock.request("screen");
        }
      } catch {}
    };

    const onVisibility = () => {
      // wake lock can be released when tab hidden; try reacquire
      if (document.visibilityState === "visible") tryWake();
    };

    document.body.classList.add("overflow-hidden");
    tryFs();
    tryWake();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.body.classList.remove("overflow-hidden");
      document.removeEventListener("visibilitychange", onVisibility);
      try {
        wakeLock && wakeLock.release && wakeLock.release();
      } catch {}
    };
  }, [tvMode, autoFs]);

  const pagePadding = tvMode ? "p-3 md:p-4" : "p-6";
  const containerMax = tvMode ? "max-w-[100vw]" : "max-w-7xl";
  const gridGap = tvMode ? "gap-3" : "gap-4";

  return (
    <main className={`mx-auto ${containerMax} ${pagePadding} space-y-4 md:space-y-6`}>
      {/* Header (hidden in TV mode) */}
      {!tvMode && (
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="Burger Brothers" className="h-8 w-auto" />
            <div className="text-2xl font-bold">Burger Brothers</div>
            <span className="ml-2 text-sm rounded-full border border-white/10 px-2 py-0.5 text-stone-300/80">
              Dashboard
            </span>
          </div>
          <Clock />
        </header>
      )}

      {/* Stats (kept in TV, just tighter) */}
      <section className={`grid grid-cols-2 md:grid-cols-4 ${tvMode ? "gap-2" : "gap-3"}`}>
        <Stat title="Lieferung (Anzahl)" value={top.lieferung} tone="from-orange-500/40 to-amber-500/10" />
        <Stat title="Abholung (Anzahl)" value={top.abholung} tone="from-sky-500/40 to-cyan-500/10" />
        <Stat title="Aktiv" value={top.active} tone="from-violet-500/40 to-fuchsia-500/10" />
        <Stat title="Abgeschlossen" value={top.finished} tone="from-emerald-500/40 to-teal-500/10" />
      </section>

      {/* Tabs + Auto refresh (hidden in TV) */}
      {!tvMode && (
        <section className="flex items-center justify-between">
          <div className="inline-flex rounded-full border border-white/10 p-1">
            <button
              className={`px-4 py-1.5 text-sm rounded-full ${
                view === "active" ? "bg-stone-800/70 font-semibold" : "opacity-70"
              }`}
              onClick={() => setView("active")}
            >
              Aktiv
            </button>
            <button
              className={`px-4 py-1.5 text-sm rounded-full ${
                view === "done" ? "bg-stone-800/70 font-semibold" : "opacity-70"
              }`}
              onClick={() => setView("done")}
            >
              Abgeschlossen
            </button>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm opacity-80">Auto-Refresh (5s)</label>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            <button className="btn-ghost ml-2" onClick={refresh}>
              ↻ Manuell
            </button>
          </div>
        </section>
      )}

      {/* Lists — left: Lieferung | right: Abholung */}
      <section className={`grid grid-cols-1 lg:grid-cols-2 ${gridGap}`}>
        {/* Lieferung */}
        <div className={`${metal} rounded-2xl ${tvMode ? "p-3" : "p-4"}`}>
          <div className="mb-3 flex items-center justify-between">
            <div className={`${tvMode ? "text-lg font-bold" : "text-lg font-semibold"}`}>Lieferung</div>
            <div className="text-sm opacity-70">{lieferungList.length}</div>
          </div>

          {lieferungList.length === 0 ? (
            <div className="text-sm text-stone-400">Keine Einträge.</div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {lieferungList.map((o) => (
                <OrderCard
                  key={o.id}
                  o={o}
                  avgPickup={avgPickup}
                  avgDelivery={avgDelivery}
                  onOpen={() => setSel(o)}
                  onStatus={(s) => setOrderStatus(o.id, s)}
                  tv={tvMode}
                />
              ))}
            </div>
          )}
        </div>

        {/* Abholung */}
        <div className={`${metal} rounded-2xl ${tvMode ? "p-3" : "p-4"}`}>
          <div className="mb-3 flex items-center justify-between">
            <div className={`${tvMode ? "text-lg font-bold" : "text-lg font-semibold"}`}>Abholung</div>
            <div className="text-sm opacity-70">{abholungList.length}</div>
          </div>

          {abholungList.length === 0 ? (
            <div className="text-sm text-stone-400">Keine Einträge.</div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {abholungList.map((o) => (
                <OrderCard
                  key={o.id}
                  o={o}
                  avgPickup={avgPickup}
                  avgDelivery={avgDelivery}
                  onOpen={() => setSel(o)}
                  onStatus={(s) => setOrderStatus(o.id, s)}
                  tv={tvMode}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Detail modal (hidden trigger in TV; modal stays reachable in normal mode) */}
      {!tvMode && sel && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={() => setSel(null)}
        >
          <div
            className="max-w-2xl w-full rounded-2xl p-5 bg-stone-950 border border-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="text-xl font-semibold">
                #{sel.id} • {sel.mode === "pickup" ? "Abholung" : "Lieferung"}
              </div>
              <button className="btn-ghost" onClick={() => setSel(null)}>
                Schließen
              </button>
            </div>

            <div className="text-sm text-stone-300/90 space-y-1">
              <div><b>Zeit:</b> {new Date(sel.ts).toLocaleString()}</div>
              <div><b>Kunde:</b> {sel.customer?.name} • {sel.customer?.phone || "-"}</div>
              {sel.customer?.address && (
                <div>
                  <b>Adressese:</b>{" "}
                  {sel.mode === "delivery" ? prettyDeliveryAddress(sel.customer.address) : sel.customer.address}
                </div>
              )}
              {sel.planned && <div><b>Geplant:</b> {sel.planned} (heute)</div>}
            </div>

            <div className="mt-3">
              <div className="font-medium mb-1">Artikel</div>
              <div className="rounded-lg border border-white/10 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-white/5 text-stone-300">
                    <tr>
                      <th className="p-2 text-left">Name</th>
                      <th className="p-2 text-right">Menge</th>
                      <th className="p-2 text-right">Summe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sel.items.map((it: any, i: number) => (
                      <tr key={i} className="border-t border-white/5 align-top">
                        <td className="p-2">
                          <div>{it.name}</div>
                          {it.note && <div className="text-xs text-stone-300 mt-0.5">{String(it.note)}</div>}
                          {Array.isArray(it.add) && it.add.length > 0 && (
                            <div className="text-xs text-stone-400">
                              Extras: {it.add.map((a: any) => a?.label || a?.name).filter(Boolean).join(", ")}
                            </div>
                          )}
                          {Array.isArray((it as any).rm) && (it as any).rm.length > 0 && (
                            <div className="text-xs text-stone-400">
                              Ohne: {(it as any).rm.join(", ")}
                            </div>
                          )}
                        </td>
                        <td className="p-2 text-right">{it.qty}</td>
                        <td className="p-2 text-right">
                          {(Number(it.price || 0) * Number(it.qty || 1)).toFixed(2)}€
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <a
                href={`/print/barcode/${encodeURIComponent(sel.id)}`}
                target="_blank"
                className="card-cta"
              >
                🖨️ Etikett (8 mm Barcode)
              </a>
              <a
                href={`/track?order=${encodeURIComponent(sel.id)}`}
                target="_blank"
                className="btn-ghost"
              >
                👁️ Kunden-Tracking
              </a>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/* ── Small UI bits ─────────────────────────────────────────────────── */
function Stat({
  title,
  value,
  tone,
}: {
  title: string;
  value: number | string;
  tone: string;
}) {
  return (
    <div className={`rounded-2xl ${metal} ${tone} ${"p-3 md:p-4"}`}>
      <div className="text-xs uppercase tracking-wider text-stone-300/70">{title}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}

function chipColor(s: OrderStatus) {
  switch (s) {
    case "new":
      return "bg-sky-500/25 text-sky-100 border-sky-400/60";
    case "preparing":
      return "bg-amber-500/25 text-amber-100 border-amber-400/60";
    case "ready":
      return "bg-emerald-500/25 text-emerald-100 border-emerald-400/60";
    case "out_for_delivery":
      return "bg-indigo-500/25 text-indigo-100 border-indigo-400/60";
    case "done":
      return "bg-lime-500/25 text-lime-100 border-lime-400/60";
    case "cancelled":
      return "bg-rose-500/25 text-rose-100 border-rose-400/60";
  }
}

function OrderCard({
  o,
  avgPickup,
  avgDelivery,
  onOpen,
  onStatus,
  tv = false,
}: {
  o: StoredOrder;
  avgPickup: number;
  avgDelivery: number;
  onOpen: () => void;
  onStatus: (s: OrderStatus) => void;
  tv?: boolean;
}) {
  useTick(1000);

  const eta = o.etaMin ?? (o.mode === "pickup" ? avgPickup : avgDelivery);
  const end = o.ts + eta * 60_000;
  const ms = Math.max(0, end - Date.now());
  const mm = Math.floor(ms / 60000);
  const ss = Math.floor((ms % 60000) / 1000);

  const addressLine = o.mode === "delivery" ? prettyDeliveryAddress(o.customer?.address) : o.customer?.address;

  return (
    <div className={`rounded-xl border ${metal} ${tv ? "p-3" : "p-4"}`}>
      <div className="flex items-center justify-between">
        <div className={`${tv ? "text-xl font-extrabold" : "font-semibold"}`}>#{o.id}</div>
        <span
          className={`rounded-full border-2 font-semibold tracking-wide ${
            tv ? "px-3 py-1.5 text-sm" : "px-3 py-1.5 text-[11px] md:text-sm"
          } ${chipColor(o.status || "new")}`}
        >
          {statusLabel[o.status || "new"]}
        </span>
      </div>

      <div className={`mt-1 text-stone-400 ${tv ? "text-sm" : "text-xs"}`}>
        {new Date(o.ts).toLocaleString()} • {o.mode === "pickup" ? "Abholung" : "Lieferung"}
      </div>

      <div className={`mt-2 ${tv ? "text-base" : "text-sm"}`}>
        <div className="opacity-80">
          Kunde: <b>{o.customer?.name}</b>
        </div>
        {addressLine && <div className="opacity-70 line-clamp-1">{addressLine}</div>}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className={`${tv ? "text-2xl" : "text-lg"} font-mono text-stone-100`}>
          {String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
          <span className="ml-2 text-xs opacity-70">(ETA {eta}′)</span>
        </div>
      </div>

      {/* Action buttons hidden in TV mode */}
      {!tv && (
        <div className="mt-3 flex flex-wrap gap-2">
          {o.mode === "pickup" ? (
            <>
              <button className="btn-ghost" onClick={() => onStatus("preparing")}>In Vorbereitung</button>
              <button className="btn-ghost" onClick={() => onStatus("ready")}>Abholbereit</button>
              <button className="card-cta" onClick={() => onStatus("done")}>Abgeschlossen</button>
            </>
          ) : (
            <>
              <button className="btn-ghost" onClick={() => onStatus("preparing")}>In Vorbereitung</button>
              <button className="btn-ghost" onClick={() => onStatus("out_for_delivery")}>Unterwegs</button>
              <button className="card-cta" onClick={() => onStatus("done")}>Abgeschlossen</button>
            </>
          )}
          <button className="btn-ghost ml-auto" onClick={onOpen}>Details</button>
        </div>
      )}
    </div>
  );
}
