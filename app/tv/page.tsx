// app/tv/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  readAllOrders,
  setOrderStatus,
  upsertOrder,
  StoredOrder,
  OrderStatus,
} from "@/lib/orders";
import { readSettings } from "@/lib/settings";

/* Brian – TV LED & grup etiketi */
import type { BrianData } from "@/lib/brian";
import {
  loadBrian,
  analyze,
  normalizeStreet,
  brianIsActive,
} from "@/lib/brian";

/* EK: yönlendirme için */
import { useRouter } from "next/navigation";

/* ───────────────── Brian kapı ayarları (DOLDUR) ─────────────────
 * Prod domain(ler)ini BRIAN_ALLOWED_HOSTS içine ekle.
 * GO_LIVE_AT: prod yayına çıkış tarihini ISO olarak yaz.
 * enableAfterDays: kaç gün sonra öneriler açılsın (default 30).
 *
 * Not: İstersen force test için:
 *  - kapıyı zorla aç:  const BRIAN_FORCE: "on" | undefined = "on";
 *  - kapıyı zorla kapa: const BRIAN_FORCE: "off" | undefined = "off";
 */
const BRIAN_ALLOWED_HOSTS = ["yourprod.com", "www.yourprod.com"]; // ← düzenle
const GO_LIVE_AT = "2025-10-26T00:00:00Z"; // ← prod yayın tarihi (ISO)
const ENABLE_AFTER_DAYS = 30;
const BRIAN_FORCE: "on" | "off" | undefined = undefined;
/* ──────────────────────────────────────────────────────────────── */

/* ─────────────── Ek Tipler ─────────────── */
type DiscountRow = { label: string; amount: number };

/* ─────────────────────────────────────────────────────────────
   GÖRSEL: Metalik cam + net tipografi
   ───────────────────────────────────────────────────────────── */
const glass =
  "backdrop-blur-xl bg-white/[0.06] border border-white/15 " +
  "shadow-[inset_0_1px_0_0_rgba(255,255,255,.20)] ring-1 ring-black/10";

const chip =
  "px-2.5 py-1 rounded-full border font-semibold text-[11px] tracking-wide";

const iconBtn =
  "rounded-md border border-white/10 px-2.5 py-1.5 hover:bg-white/10";

/* ───────────────── Labels (DE) ───────────────── */
const statusLabel: Record<OrderStatus, string> = {
  new: "Eingegangen",
  preparing: "In Vorbereitung",
  ready: "Abholbereit",
  out_for_delivery: "Unterwegs",
  done: "Abgeschlossen",
  cancelled: "Storniert",
};

function chipColor(s: OrderStatus) {
  switch (s) {
    case "new":
      return "border-sky-400/60 bg-sky-500/20 text-sky-100";
    case "preparing":
      return "border-amber-400/60 bg-amber-500/20 text-amber-100";
    case "ready":
      return "border-emerald-400/60 bg-emerald-500/20 text-emerald-100";
    case "out_for_delivery":
      return "border-indigo-400/60 bg-indigo-500/20 text-indigo-100";
    case "done":
      return "border-lime-400/60 bg-lime-500/20 text-lime-100";
    case "cancelled":
      return "border-rose-400/60 bg-rose-500/20 text-rose-100";
  }
}

/* ───────────────── Utils ───────────────── */
function appTZ(s: any) {
  return String(s?.hours?.timezone || s?.hours?.tz || "Europe/Berlin");
}
const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

/* sayı/para yardımcıları */
const num = (v: any) => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v == null) return 0;
  const s = String(v).trim().replace(/[€\s]/g, "").replace(",", ".");
  const m = s.match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : 0;
};
const money = (v: any) => `${num(v).toFixed(2)}€`;

/* ücret yakalayıcı */
function findDeliveryFeeDeep(order: any) {
  const P = order?.pricing || {};
  const F = order?.fees || {};
  const direct = [
    P.delivery,
    P.deliveryFee,
    P.deliverySurcharge,
    P.surcharges,
    P.surcharge,
    P.shipping,
    P.ship,
    P.delivery_cost,
    P.zoneFee,
    F.delivery,
    F.deliveryFee,
    F.deliverySurcharge,
    F.surcharges,
    F.surcharge,
    F.shipping,
  ]
    .map(num)
    .find((x) => x > 0);
  if (direct) return direct;

  const rx =
    /(liefer|lieferung|liefergeb|lieferaufschlag|zustell|versand|shipping|delivery|surcharge|aufschlag|zone)/i;
  const buckets = [
    order?.totals,
    order?.summary,
    order?.surcharges,
    P?.totals,
    P?.summary,
    P?.breakdown,
    P?.surcharges,
    F?.totals,
    F?.summary,
    F?.surcharges,
  ].filter(Array.isArray);

  for (const arr of buckets) {
    for (const row of arr) {
      const label = String(row?.label || row?.title || row?.name || "").toLowerCase();
      if (rx.test(label)) {
        const val = num(row?.amount ?? row?.value ?? row?.price ?? row?.total);
        if (val > 0) return val;
      }
    }
  }
  return 0;
}

/* toplamları güvenli hesapla */
function getOrderTotals(o: StoredOrder): {
  subtotal: number;
  deliveryFee: number;
  serviceFee: number;
  otherFee: number;
  discountSum: number;
  discountItems: DiscountRow[];
  total: number;
} {
  const items = Array.isArray(o?.items) ? o.items : [];
  const P = (o as any)?.pricing || {};
  const F = (o as any)?.fees || {};

  const itemsSum = items.reduce(
    (s: number, it: any) => s + num(it.price) * num(it.qty || 1),
    0
  );
  const subtotal = num(P.subtotal) > 0 ? num(P.subtotal) : itemsSum;

  const deliveryFee = findDeliveryFeeDeep(o);
  const serviceFee = num(P.service ?? F.service);
  const otherFee = num(P.other ?? P.misc ?? F.other);

  let explicitTotal = num(
    P.total ?? (o as any).total ?? (o as any).amount ?? (o as any).payable ?? (o as any).toPay
  );
  if (explicitTotal <= 0) {
    explicitTotal = subtotal + deliveryFee + serviceFee + otherFee - num(P.discount ?? F.discount);
  }

  let discountSum = num(P.discount ?? F.discount);
  const fees = deliveryFee + serviceFee + otherFee;
  const derivedDiscount = Math.max(0, subtotal + fees - explicitTotal);
  if (Math.abs(subtotal + fees - explicitTotal - discountSum) > 0.01) {
    discountSum = derivedDiscount;
  }

  const discountItems: DiscountRow[] = Array.isArray((o as any)?.adjustments)
    ? (o as any).adjustments
        .filter((a: any) => String(a?.type || "").toLowerCase() === "discount")
        .map((a: any) => ({
          label: [a?.code, a?.reason].filter(Boolean).join(" – ") || a?.source || "Rabatt",
          amount: num(a?.amount),
        }))
    : [];

  return {
    subtotal,
    deliveryFee,
    serviceFee,
    otherFee,
    discountSum,
    discountItems,
    total: explicitTotal,
  };
}

/* ▼ Açıklama toplayıcı – geniş kapsamlı */
function extractOrderNote(o: any): string {
  const c = o?.customer || {};
  const m = o?.meta || {};
  const d = o?.delivery || {};
  const adr = c?.addressInfo || c?.addresses || {};

  const candidates: any[] = [
    o?.note,
    o?.orderNote,
    o?.deliveryNote,
    o?.comment,
    o?.comments,
    o?.checkoutNote,
    o?.basketNote,
    o?.cartNote,
    o?.extraNote,
    d?.note,
    m?.note,
    m?.deliveryNote,
    m?.orderNote,
    c?.note,
    c?.orderNote,
    c?.deliveryNote,
    c?.deliveryHint,
    c?.hinweis,
    adr?.note,
    adr?.hint,
  ];

  const found = candidates.find((x) => {
    const s = (typeof x === "string" ? x : "").trim();
    return s.length > 0;
  });

  return (found || "").toString();
}

function plannedStartMs(o: StoredOrder, tz: string) {
  if (!o?.planned) return null;
  const [hh, mm] = String(o.planned).split(":").map((x) => parseInt(x, 10));
  if (Number.isNaN(hh)) return null;
  const base = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
  const d = new Date(base);
  d.setHours(hh || 0, mm || 0, 0, 0);
  return d.getTime();
}

function etaFor(o: StoredOrder, avgPickup: number, avgDelivery: number) {
  return o.etaMin ?? (o.mode === "pickup" ? avgPickup : avgDelivery);
}

function remainingMinutes(
  o: StoredOrder,
  avgPickup: number,
  avgDelivery: number,
  tz: string
) {
  const eta = etaFor(o, avgPickup, avgDelivery);
  const p = plannedStartMs(o, tz);
  const start = p && p > Date.now() ? p : o.ts || Date.now();
  const end = start + eta * 60_000;
  const ms = Math.max(0, end - Date.now());
  return Math.floor(ms / 60_000);
}

function autoDisplayStatus(
  o: StoredOrder,
  avgPickup: number,
  avgDelivery: number,
  newGraceMin: number,
  tz: string
): OrderStatus {
  if (o.status === "done" || o.status === "cancelled") return o.status;
  if (o.status && o.status !== "new") return o.status;

  const pMs = plannedStartMs(o, tz);
  if (pMs && pMs > Date.now()) return "new";

  const eta = etaFor(o, avgPickup, avgDelivery);
  const start = o.ts || Date.now();
  const elapsedMin = Math.max(0, Math.floor((Date.now() - start) / 60_000));
  if (elapsedMin < newGraceMin) return "new";

  if (o.mode === "pickup") {
    const ratio = elapsedMin / Math.max(1, eta);
    return ratio < 0.7 ? "preparing" : "ready";
  }
  return "preparing";
}

function dayBoundsMs(tz: string) {
  const now = new Date();
  const local = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  const start = new Date(local);
  start.setHours(0, 1, 0, 0);
  const end = new Date(local);
  end.setHours(23, 59, 59, 999);
  return { start: start.getTime(), end: end.getTime() };
}

const LS_PAUSE = "bb_pause_v1";
type PauseState = { delivery: boolean; pickup: boolean };
function readPause(): PauseState {
  try {
    const v = JSON.parse(localStorage.getItem(LS_PAUSE) || "{}") as PauseState;
    return { delivery: !!v.delivery, pickup: !!v.pickup };
  } catch {
    return { delivery: false, pickup: false };
  }
}
function writePause(p: PauseState) {
  try {
    localStorage.setItem(LS_PAUSE, JSON.stringify(p));
    window.dispatchEvent(new StorageEvent("storage", { key: LS_PAUSE }));
  } catch {}
}

function Clock() {
  const [, setT] = useState(0);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const id = setInterval(() => setT((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span suppressHydrationWarning className="opacity-80">
      {mounted ? new Date().toLocaleString() : ""}
    </span>
  );
}

function formatDeliveryLine(o: StoredOrder) {
  const raw = String(o?.customer?.address || "");
  if (!raw) return "";
  const parts = raw.split("|").map((s) => s.trim());
  const streetHouse = parts[0] || "";
  const zipMatch = (parts[1] || raw).match(/\b\d{5}\b/);
  const zip = zipMatch ? zipMatch[0] : "";
  return [zip, streetHouse].filter(Boolean).join(" ");
}

function getDriverName(o: any): string {
  return (o?.driver && o.driver.name) || o?.driverName || "";
}

function daysUntilActive(meta: BrianData["meta"] | undefined): number | null {
  try {
    const startIso = GO_LIVE_AT || meta?.firstLearnAt || null;
    if (!startIso) return null;
    const start = new Date(startIso);
    const now = new Date();
    const diffDays = Math.floor((+start - +now) / (1000 * 60 * 60 * 24)) * -1;
    const remain = ENABLE_AFTER_DAYS - diffDays;
    return remain > 0 ? remain : 0;
  } catch {
    return null;
  }
}

function OrderCard({
  o,
  avgPickup,
  avgDelivery,
  tz,
  onOpen,
  onStatus,
  onAdjust,
  onRefresh,
  led,
  clusterDot,
}: {
  o: StoredOrder;
  avgPickup: number;
  avgDelivery: number;
  tz: string;
  onOpen: () => void;
  onStatus: (s: OrderStatus) => void;
  onAdjust: (deltaMin: number) => void;
  onRefresh: () => void;
  led: "green" | "red" | "gray";
  clusterDot?: string | null;
}) {
  const leftMin = remainingMinutes(o, avgPickup, avgDelivery, tz);
  const pMs = plannedStartMs(o, tz);
  const plannedFuture = !!pMs && pMs > Date.now();
  const driverName = getDriverName(o);
  const isFinal = o.status === "done" || o.status === "cancelled";

  const modeChip =
    o.mode === "pickup"
      ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-200"
      : "border-orange-400/60 bg-orange-500/15 text-orange-200";

  const addressLine = o.mode === "delivery" ? formatDeliveryLine(o) : "";

  const ledColor =
    led === "green" ? "#22c55e" : led === "red" ? "#ef4444" : "#94a3b8";

  const timeClass =
    !plannedFuture && !isFinal
      ? leftMin <= 10
        ? "tv-minutes tv-minutes--crit"
        : leftMin <= 20
        ? "tv-minutes tv-minutes--warn"
        : "tv-minutes"
      : "tv-minutes";

  const startTime =
    (o as any).outForDeliveryAt ?? (o as any).claimedAt ?? o.ts;

  return (
    <div className={`relative rounded-2xl p-4 ${glass}`}>
      {/* Brian LED */}
      <span
        className="absolute right-2 top-2 h-5 w-5 rounded-full ring-2 ring-stone-900"
        style={{ backgroundColor: ledColor }}
        title={led.toUpperCase()}
      />

      {/* Üst satır: mod & status */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`${chip} ${modeChip}`}>
            {o.mode === "pickup" ? "Abholung" : "Lieferung"}
          </span>
          {plannedFuture && (
            <span
              className={`${chip} border-amber-400/60 bg-amber-500/15 text-amber-100`}
            >
              Geplant {o.planned}
            </span>
          )}
        </div>

        {/* Unterwegs süresi */}
        {o.status === "out_for_delivery" && startTime && (
          <div className="ml-auto mt-1 text-[11px] text-stone-400 font-medium">
            {(() => {
              const since = Math.floor((Date.now() - startTime) / 60000);
              if (since < 1) return "Gerade eben";
              if (since < 60) return `vor ${since} Min`;
              const h = Math.floor(since / 60);
              const m = since % 60;
              return m > 0 ? `vor ${h} Std ${m} Min` : `vor ${h} Std`;
            })()}
          </div>
        )}

        {/* Fahrer + status */}
        <div className="flex items-center gap-2">
          {driverName &&
            (o.status === "out_for_delivery" || o.status === "done") && (
              <span
                className={`${chip} border-indigo-300/60 bg-indigo-400/15 text-indigo-100`}
              >
                Fahrer: {driverName}
              </span>
            )}
          <span className={`${chip} ${chipColor(o.status || "new")}`}>
            {statusLabel[o.status || "new"]}
          </span>
        </div>
      </div>

      {/* Büyük zaman alanı */}
      {!isFinal && (
        <div className="mt-3 flex items-end justify-between">
          <div className={timeClass} aria-live="polite">
            {plannedFuture ? (
              <span>
                {o.planned!.split(":").map((n) => pad2(+n || 0)).join(":")}
              </span>
            ) : (
              <span>{pad2(leftMin)}</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button className={iconBtn} onClick={() => onAdjust(-5)} title="-5 Min">
              −5′
            </button>
            <button className={iconBtn} onClick={() => onAdjust(+5)} title="+5 Min">
              +5′
            </button>
          </div>
        </div>
      )}

      {/* Adresse */}
      {o.mode === "delivery" && addressLine && (
        <div className="mt-3 text-lg font-semibold flex items-center gap-2">
          {addressLine}
          {clusterDot && (
            <span
              className="inline-block h-3.5 w-3.5 rounded-full"
              style={{ backgroundColor: clusterDot }}
              title="Brian group"
            />
          )}
        </div>
      )}

      {/* Alt butonlar */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {o.mode === "pickup" ? (
          <>
            <button className="btn-ghost" onClick={() => onStatus("preparing")}>
              In Vorbereitung
            </button>
            <button className="btn-ghost" onClick={() => onStatus("ready")}>
              Abholbereit
            </button>
            <button className="card-cta" onClick={() => onStatus("done")}>
              Abgeschlossen
            </button>
          </>
        ) : (
          <>
            <button className="btn-ghost" onClick={() => onStatus("preparing")}>
              In Vorbereitung
            </button>
            <button
              className="btn-ghost"
              onClick={() => onStatus("out_for_delivery")}
              title="Şoför QR sonrası basılır"
            >
              Unterwegs
            </button>
            <button className="card-cta" onClick={() => onStatus("done")}>
              Abgeschlossen
            </button>
          </>
        )}

        {/* Unterwegs iken şoförü kaldır */}
        {o.status === "out_for_delivery" && driverName ? (
          <button
            className="btn-ghost"
            onClick={async () => {
              await upsertOrder({
                ...(o as any),
                driver: null as any,
                driverName: "",
                claimedAt: null,
                outForDeliveryAt: null,
              });
              await setOrderStatus(o.id, "preparing");
              onRefresh();
            }}
            title="Fahrer entfernen"
          >
            Fahrer entfernen
          </button>
        ) : null}

        <button className="btn-ghost ml-auto" onClick={onOpen}>
          Details
        </button>
      </div>
    </div>
  );
}

/* ─────────────── YAZDIRMA ─────────────── */
async function silentPrint(order: StoredOrder) {
  try {
    const proxy =
      (typeof window !== "undefined" &&
        (localStorage.getItem("bb_print_proxy_url") || "")) ||
      "https://www.burger-brothers.berlin";

    const res = await fetch(`${proxy}/print/full`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order,
        options: {
          paper: "80mm",
          copies: 1,
          maskName: true,
          maskPhone: true,
        },
      }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Proxy ${res.status}: ${txt}`);
    }
    alert("🖨️ Druckauftrag gesendet.");
  } catch (e: any) {
    console.error(e);
    alert(
      `Drucken fehlgeschlagen: ${e?.message || e}\n` +
        `• Läuft der print-proxy?\n` +
        `• Firewall/CORS blockiert?\n` +
        `• bb_print_proxy_url korrekt?`
    );
  }
}

export default function TVPage() {
  const router = useRouter();

  useEffect(() => {
    // Sadece UI cookie'sine ve sekme işaretine bak
    const hasUi = document.cookie.split("; ").some((c) => c.startsWith("bb_tv_ui=1"));
    let hasTab = false;
    try { hasTab = sessionStorage.getItem("bb_tv_tab") === "1"; } catch {}

    if (!hasUi || !hasTab) {
      router.replace("/tv/login");
    }
  }, [router]);

  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const [orders, setOrders] = useState<StoredOrder[]>([]);
  const [sel, setSel] = useState<StoredOrder | null>(null);

  type View = "incoming" | "onroad" | "finished";
  const [view, setView] = useState<View>("incoming");

  const [leftOpen, setLeftOpen] = useState(false);
  const [pause, setPause] = useState<PauseState>({
    delivery: false,
    pickup: false,
  });

  const [brianData, setBrianData] = useState<BrianData | null>(null);

  useEffect(() => {
    loadBrian()
      .then(setBrianData)
      .catch(() => setBrianData({ clusters: [], pairs: [], meta: {} } as any));
  }, []);

  const settings = readSettings() as any;
  const tz = appTZ(settings);
  const avgPickup = Number(settings?.hours?.avgPickupMinutes ?? 15);
  const avgDelivery = Number(settings?.hours?.avgDeliveryMinutes ?? 35);
  const newGraceMin = Math.max(0, Number(settings?.hours?.newGraceMinutes ?? 5));

  // Pause state: LS'ten yükle + ESC ile çekmece kapat
  useEffect(() => {
    setPause(readPause());
    const onSt = (e: StorageEvent) => {
      if (e.key === LS_PAUSE || !e.key) setPause(readPause());
    };
    window.addEventListener("storage", onSt);

    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLeftOpen(false);
    };
    window.addEventListener("keydown", onEsc);

    return () => {
      window.removeEventListener("storage", onSt);
      window.removeEventListener("keydown", onEsc);
    };
  }, []);

  /* Brian 1-ay kapısı (domain + süre) */
  const host =
    typeof window !== "undefined" ? window.location.host : undefined;
  const gateOn = useMemo(
    () =>
      brianIsActive(brianData?.meta, {
        host,
        allowedHosts: BRIAN_ALLOWED_HOSTS,
        goLiveAt: GO_LIVE_AT,
        enableAfterDays: ENABLE_AFTER_DAYS,
        force: BRIAN_FORCE,
      }),
    [host, brianData]
  );
  const daysLeft = useMemo(() => daysUntilActive(brianData?.meta), [brianData]);

  /* GÜNLÜK: 00:01–23:59 (Berlin TZ) */
  const refresh = () => {
    const all = readAllOrders();

    const advanced = all.map((o) => ({
      ...o,
      status: autoDisplayStatus(o, avgPickup, avgDelivery, newGraceMin, tz),
    }));

    const { start, end } = dayBoundsMs(tz);

    const today = advanced.filter((o) => {
      const ts = o.ts ?? 0;
      const p = plannedStartMs(o, tz);
      const inByTs = ts >= start && ts <= end;
      const inByPlanned = p != null && p >= start && p <= end;
      return inByTs || inByPlanned;
    });

    setOrders(today);
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line

  const filtered = useMemo(() => {
    return orders
      .filter((o) => {
        if (view === "incoming")
          return (
            o.status !== "done" &&
            o.status !== "cancelled" &&
            o.status !== "out_for_delivery"
          );
        if (view === "onroad") return o.status === "out_for_delivery";
        return o.status === "done" || o.status === "cancelled";
      })
      .sort((a, b) => b.ts - a.ts);
  }, [orders, view]);

  const handleAdjust = (o: StoredOrder, delta: number) => {
    const cur = etaFor(o, avgPickup, avgDelivery);
    const next = Math.max(1, Math.min(cur + delta, (o.etaMin ?? cur) + 60, 240));
    upsertOrder({ ...o, etaMin: next });
    refresh();
  };

  return (
    <main
      className={
        "relative mx-auto max-w-7xl p-4 sm:p-6 space-y-6 text-stone-100 " +
        "antialiased [text-rendering:optimizeLegibility] [font-feature-settings:'liga','kern']"
      }
    >
      {/* BACKGROUND LAYERS */}
      <div className="pointer-events-none select-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(1200px_700px_at_10%_-10%,rgba(59,130,246,.18),transparent),radial-gradient(1000px_600px_at_90%_0%,rgba(16,185,129,.14),transparent),linear-gradient(180deg,#0b0f14_0%,#0f1318_50%,#0a0d11_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(80%_80%_at_50%_20%,transparent,rgba(0,0,0,.45))]" />
        <div
          className="absolute inset-0 opacity-[0.08] mix-blend-overlay"
          style={{
            backgroundImage:
              "url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22 viewBox=%220 0 40 40%22><filter id=%22n%22><feTurbulence type=%22fractalNoise%22 baseFrequency=%220.8%22 numOctaves=%222%22 stitchTiles=%22stitch%22/></filter><rect width=%2240%22 height=%2240%22 filter=%22url(%23n)%22 opacity=%220.35%22/></svg>')",
          }}
        />
      </div>

      {/* Üst Header */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            className={`${iconBtn} mr-1`}
            onClick={() => setLeftOpen(true)}
            title="Menü"
          >
            ☰
          </button>
          <div className="flex items-center gap-2">
            <img src="/logo-burger-brothers.png" className="h-14 w-14" alt="Logo" />
            <div className="text-2xl font-bold">Burger Brothers</div>
          </div>
        </div>

        {/* Sağ: Saat + Çıkış */}
        <div className="flex items-center gap-3">
          <Clock />
          <button
            onClick={async () => {
              try { await fetch("/api/tv/logout", { method: "POST" }); } catch {}
              try { sessionStorage.removeItem("bb_tv_tab"); } catch {}
              router.replace("/tv/login");
            }}
            title="Çıkış"
            className={iconBtn}
          >
            ⏻ Çıkış
          </button>
        </div>
      </header>

      {/* Brian banner gizlendi */}

      {(pause.delivery || pause.pickup) && (
        <div className="rounded-xl p-3 border border-amber-400/40 bg-amber-500/15 text-amber-100 text-sm">
          {pause.delivery && (
            <div>
              Aufgrund hoher Auslastung ist <b>Lieferung</b> vorübergehend pausiert.
            </div>
          )}
          {pause.pickup && (
            <div>
              Aufgrund hoher Auslastung ist <b>Abholung</b> vorübergehend pausiert.
            </div>
          )}
        </div>
      )}

      {/* 3 Durum Sekmesi */}
      <section className="flex items-center gap-2">
        <button
          onClick={() => setView("incoming")}
          className={`rounded-full px-4 py-1.5 border border-white/10 ${
            view === "incoming" ? "bg-white/10 font-semibold" : "opacity-70"
          }`}
        >
          Neu
        </button>
        <button
          onClick={() => setView("onroad")}
          className={`rounded-full px-4 py-1.5 border border-white/10 ${
            view === "onroad" ? "bg-white/10 font-semibold" : "opacity-70"
          }`}
        >
          Unterwegs
        </button>
        <button
          onClick={() => setView("finished")}
          className={`rounded-full px-4 py-1.5 border border-white/10 ${
            view === "finished" ? "bg-white/10 font-semibold" : "opacity-70"
          }`}
        >
          Fertig
        </button>
      </section>

      {/* Liste */}
      <section className="grid grid-cols-1 gap-4">
        {filtered.length === 0 ? (
          <div className="text-sm text-stone-400">Keine Einträge.</div>
        ) : (
          filtered.map((o) => {
            const peers = filtered
              .filter((x) => x.id !== o.id && x.mode === "delivery")
              .map((x) => x.customer?.address || "")
              .map(normalizeStreet);

            const result =
              o.mode === "delivery"
                ? analyze(o.customer?.address || "", peers, brianData, gateOn)
                : { led: "gray" as const, clusterColor: undefined };

            return (
              <OrderCard
                key={o.id}
                o={o}
                avgPickup={avgPickup}
                avgDelivery={avgDelivery}
                tz={tz}
                onOpen={() => setSel(o)}
                onStatus={async (s) => {
                  if (s === "out_for_delivery") {
                    // 1) order alanını güncelle
                    await upsertOrder({
                      ...(o as any),
                      outForDeliveryAt: Date.now(),
                    });

                    // 2) Brian öğrenme: aynı dalgadaki delivery sokakları
                    try {
                      const streets = Array.from(
                        new Set(
                          filtered
                            .filter(
                              (x) =>
                                x.mode === "delivery" &&
                                (x.id === o.id || x.status === "out_for_delivery")
                            )
                            .map((x) => x.customer?.address || "")
                            .map(normalizeStreet)
                            .filter(Boolean)
                        )
                      );
                      if (streets.length > 0) {
                        await fetch("/api/brian/learn", {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({
                            occurredAt: new Date().toISOString(),
                            mode: "delivery",
                            streets,
                          }),
                        });
                      }
                    } catch (e) {
                      console.error("brian.learn failed", e);
                    }
                  } else if (o.status === "out_for_delivery") {
                    await upsertOrder({
                      ...(o as any),
                      outForDeliveryAt: null,
                    });
                  }

                  await setOrderStatus(o.id, s);
                  refresh();
                }}
                onAdjust={(d) => handleAdjust(o, d)}
                onRefresh={refresh}
                led={result.led}
                clusterDot={result.clusterColor}
              />
            );
          })
        )}
      </section>

      {/* Detay Modal */}
      {sel && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={() => setSel(null)}
        >
          <div
            className={`max-w-2xl w-full rounded-2xl p-5 ${glass}`}
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

            {/* Üst bilgiler */}
            <div className="text-sm text-stone-300/90 space-y-1">
              <div>
                <b>Zeit:</b> {new Date(sel.ts).toLocaleString()}
              </div>
              {sel.planned && (
                <div>
                  <b>Geplant:</b> {sel.planned} (heute)
                </div>
              )}
              <div>
                <b>Kunde:</b> {sel.customer?.name} • {sel.customer?.phone || "-"}
              </div>
              {sel.mode === "delivery" && formatDeliveryLine(sel) && (
                <div>
                  <b>Adresse:</b> {formatDeliveryLine(sel)}
                </div>
              )}
              {getDriverName(sel) && (
                <div>
                  <b>Fahrer:</b> {getDriverName(sel)}
                </div>
              )}
            </div>

            {/* Artikel */}
            <div className="mt-4">
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
                          {it.note && (
                            <div className="text-xs text-stone-300 mt-0.5">
                              {String(it.note)}
                            </div>
                          )}
                          {Array.isArray(it.add) && it.add.length > 0 && (
                            <div className="text-xs text-stone-400">
                              Extras:{" "}
                              {it.add
                                .map((a: any) => a?.label || a?.name)
                                .filter(Boolean)
                                .join(", ")}
                            </div>
                          )}
                          {Array.isArray(it.rm) && it.rm.length > 0 && (
                            <div className="text-xs text-stone-400">
                              Ohne: {it.rm.join(", ")}
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

            {/* Sipariş Notu – Artikel’in hemen ALTINDA */}
            {extractOrderNote(sel) && (
              <div className="mt-4 rounded-xl border border-white/10 p-3 text-sm">
                <div className="font-medium mb-1">Bestellhinweis</div>
                <div className="text-stone-200 whitespace-pre-wrap">
                  {extractOrderNote(sel)}
                </div>
              </div>
            )}

            {/* KOSTEN ÖZETİ – EN ALTTA */}
            {(() => {
              const t = getOrderTotals(sel);
              return (
                <div className="mt-4 rounded-xl border border-white/10 overflow-hidden">
                  <table className="w-full text-sm">
                    <tbody>
                      <tr className="border-b border-white/10">
                        <td className="p-2">Warenwert</td>
                        <td className="p-2 text-right">{money(t.subtotal)}</td>
                      </tr>
                      {t.deliveryFee || t.serviceFee || t.otherFee ? (
                        <>
                          {t.deliveryFee ? (
                            <tr className="border-b border-white/10">
                              <td className="p-2">Lieferaufschläge</td>
                              <td className="p-2 text-right">{money(t.deliveryFee)}</td>
                            </tr>
                          ) : null}
                          {t.serviceFee ? (
                            <tr className="border-b border-white/10">
                              <td className="p-2">Service</td>
                              <td className="p-2 text-right">{money(t.serviceFee)}</td>
                            </tr>
                          ) : null}
                          {t.otherFee ? (
                            <tr className="border-b border-white/10">
                              <td className="p-2">Sonstiges</td>
                              <td className="p-2 text-right">{money(t.otherFee)}</td>
                            </tr>
                          ) : null}
                        </>
                      ) : null}
                      <tr className="border-b border-white/10">
                        <td className="p-2">Rabatte</td>
                        <td className="p-2 text-right">
                          {t.discountSum ? `-${money(t.discountSum)}` : money(0)}
                        </td>
                      </tr>
                      {t.discountItems.map((d: DiscountRow, i: number) => (
                        <tr key={i} className="border-b border-white/10 text-stone-300/90">
                          <td className="p-2 pl-6">- {d.label}</td>
                          <td className="p-2 text-right">-{money(d.amount)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td className="p-2 font-semibold">Gesamt (zu zahlen)</td>
                        <td className="p-2 text-right font-semibold">{money(t.total)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              );
            })()}

            {/* Yazdır seçenekleri */}
            <div className="mt-4 flex flex-wrap gap-2 items-center">
              <button
                className="card-cta"
                onClick={() => silentPrint(sel)}
                title="über print-proxy drucken"
              >
                🖨️ Drucken
              </button>

              <a
                className="btn-ghost"
                href={`/print/barcode/${encodeURIComponent(sel.id)}?print=1`}
                target="_blank"
                rel="noreferrer"
                title="PDF/print-Seite öffnen"
              >
                PDF öffnen
              </a>

              <button
                className="px-3 py-1.5 rounded-md border border-rose-400/60 text-rose-100 bg-rose-500/20 hover:bg-rose-500/30 ml-auto"
                onClick={() => {
                  const ok = confirm(`Bestellung #${sel.id} stornieren?`);
                  if (!ok) return;
                  setOrderStatus(sel.id, "cancelled");
                  setSel(null);
                  refresh();
                }}
              >
                🛑 Stornieren
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sol çekmece */}
      {leftOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50"
          onClick={() => setLeftOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className={`absolute left-0 top-0 h-full w-[320px] p-4 ${glass}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="text-lg font-semibold">Bestellübersicht</div>
              <button className="btn-ghost" onClick={() => setLeftOpen(false)}>
                Schließen
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <div className="text-xs uppercase tracking-wider text-stone-300/70 mb-1">
                  Zusammenfassung
                </div>
                <SummaryGrid orders={orders} />
              </div>

              <PauseBlock pause={pause} setPause={setPause} />
            </div>
          </div>
        </div>
      )}

      {/* Global TV sayaç stilleri */}
      <style jsx global>{`
        .tv-minutes {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
            "Liberation Mono", "Courier New", monospace;
          font-weight: 900;
          line-height: 0.9;
          letter-spacing: -0.02em;
          font-size: 3rem;
        }
        @media (min-width: 768px) {
          .tv-minutes {
            font-size: 3.75rem;
          }
        }
        .tv-minutes--warn {
          color: #fdba74;
          text-shadow: 0 0 16px rgba(253, 186, 116, 0.35);
        }
        .tv-minutes--crit {
          color: #f87171;
          text-shadow: 0 0 18px rgba(248, 113, 113, 0.45);
          animation: bb-blink 1.2s ease-in-out infinite;
        }
        @keyframes bb-blink {
          0%, 100% { filter: drop-shadow(0 0 0 rgba(248,113,113,0)); opacity: 1; }
          50% { filter: drop-shadow(0 0 18px rgba(248,113,113,0.6)); opacity: 0.82; }
        }
      `}</style>
    </main>
  );
}

function SummaryGrid({ orders }: { orders: StoredOrder[] }) {
  const stats = useMemo(() => {
    const total = orders.length;
    const lifa = orders.filter((o) => o.mode === "delivery").length;
    const apollon = orders.filter((o) => o.mode === "pickup").length;
    const active = orders.filter(
      (o) => o.status !== "done" && o.status !== "cancelled"
    ).length;
    const finished = orders.filter(
      (o) => o.status === "done" || o.status === "cancelled"
    ).length;
    const onroad = orders.filter((o) => o.status === "out_for_delivery").length;
    return { total, lifa, apollon, active, finished, onroad };
  }, [orders]);

  const Item = ({ label, value }: { label: string; value: number }) => (
    <div className={`rounded-lg p-2 ${glass}`}>
      <div className="text-[11px] opacity-80">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );

  return (
    <div className="grid grid-cols-2 gap-2">
      <Item label="Gesamt" value={stats.total} />
      <Item label="Aktiv" value={stats.active} />
      <Item label="Unterwegs" value={stats.onroad} />
      <Item label="Fertig" value={stats.finished} />
      <Item label="Lieferung" value={stats.lifa} />
      <Item label="Abholung" value={stats.apollon} />
    </div>
  );
}

/* iOS tarzı Switch */
function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      aria-pressed={checked}
      className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 transition
        ${checked ? "border-emerald-400/40 bg-emerald-500/10" : "border-white/10 bg-white/5"}`}
    >
      <span>{label}</span>

      <span
        className={`flex h-6 w-11 items-center rounded-full p-0.5 overflow-hidden transition
          ${checked ? "bg-emerald-400 justify-end" : "bg-stone-600 justify-start"}`}
      >
        <span className="h-5 w-5 rounded-full bg-white shadow" />
      </span>
    </button>
  );
}

function PauseBlock({
  pause,
  setPause,
}: {
  pause: PauseState;
  setPause: (p: PauseState) => void;
}) {
  const toggle = (key: keyof PauseState) => {
    const next = { ...pause, [key]: !pause[key] };
    setPause(next);
    writePause(next);
  };

  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wider text-stone-300/70">Pause</div>
      <ToggleSwitch
        checked={!!pause.delivery}
        onChange={() => toggle("delivery")}
        label="Lieferung pausieren"
      />
      <ToggleSwitch
        checked={!!pause.pickup}
        onChange={() => toggle("pickup")}
        label="Abholung pausieren"
      />
    </div>
  );
}
