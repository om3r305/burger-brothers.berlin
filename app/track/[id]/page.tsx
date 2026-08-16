// app/track/[id]/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { fetchAndApplyRemoteSettings, readSettings } from "@/lib/settings";
import { bindGeneralPushToOrder } from "@/lib/client/general-push";
import GoogleDeliveryMap, {
  type TrackingRouteInfo,
} from "@/components/tracking/GoogleDeliveryMap";

/* ---- UI helpers ---- */

const glass =
  "backdrop-blur-xl bg-white/[0.06] border border-white/15 shadow-[inset_0_1px_0_0_rgba(255,255,255,.20)] ring-1 ring-black/10";

const chip =
  "px-2.5 py-1 rounded-full border font-semibold text-[11px] tracking-wide";

type OrderStatus =
  | "new"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "done"
  | "cancelled";

type OrderMode = "pickup" | "delivery";

type TrackedOrder = {
  id: string;
  orderId?: string;
  ts?: number;
  createdAt?: string | null;
  updatedAt?: string | null;
  mode: OrderMode;
  status: OrderStatus;
  legacyStatus?: string;
  etaMin?: number | null;
  etaAdjustMin?: number | null;
  planned?: string | null;
  customer?: Record<string, any>;
  customerName?: string;
  phone?: string;
  addressLine?: string;
  note?: string;
  items?: any[];
  total?: number;
  meta?: Record<string, any>;
  driver?: any;
  deliveryDestination?: {
    lat: number;
    lng: number;
  } | null;
  doneAt?: string | null;
  cancelledAt?: string | null;
};

type LivePos = {
  lat: number;
  lng: number;
  ts?: number;
};

const statusLabel: Record<OrderStatus, string> = {
  new: "Eingegangen",
  preparing: "In Vorbereitung",
  ready: "Abholbereit",
  out_for_delivery: "Unterwegs",
  done: "Abgeschlossen",
  cancelled: "Storniert",
};

function chipColor(status: OrderStatus) {
  switch (status) {
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

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

function cleanTrackingToken(value: any) {
  return String(value || "")
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "");
}

const cleanOrderId = cleanTrackingToken;

function sameOrderId(a: any, b: any) {
  return cleanOrderId(a).toLowerCase() === cleanOrderId(b).toLowerCase();
}

function toNum(value: any, fallback = 0) {
  const n = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

function toMs(value: any, fallback = Date.now()) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (value instanceof Date && Number.isFinite(value.valueOf())) {
    return value.getTime();
  }

  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;

    const d = new Date(value);
    if (Number.isFinite(d.valueOf())) return d.getTime();
  }

  return fallback;
}

function normalizeStatus(value: any): OrderStatus {
  const status = String(value || "").toLowerCase().trim();

  if (status === "new" || status === "received" || status === "eingegangen") return "new";

  if (
    status === "preparing" ||
    status === "prepare" ||
    status === "zubereitung" ||
    status === "in_vorbereitung" ||
    status === "in vorbereitung"
  ) {
    return "preparing";
  }

  if (status === "ready" || status === "abholbereit" || status === "bereit") return "ready";

  if (
    status === "out_for_delivery" ||
    status === "on_the_way" ||
    status === "unterwegs"
  ) {
    return "out_for_delivery";
  }

  if (
    status === "done" ||
    status === "completed" ||
    status === "delivered" ||
    status === "abgeschlossen" ||
    status === "geliefert"
  ) {
    return "done";
  }

  if (status === "cancelled" || status === "canceled" || status === "storniert") {
    return "cancelled";
  }

  return "new";
}

function normalizeMode(value: any): OrderMode {
  const mode = String(value || "").toLowerCase().trim();

  if (mode === "pickup" || mode === "abholung" || mode === "apollo" || mode === "apollon") {
    return "pickup";
  }

  return "delivery";
}

function appTZ(settings: any) {
  return String(settings?.hours?.timezone || settings?.hours?.tz || "Europe/Berlin");
}

function plannedStartMs(order: TrackedOrder, tz: string) {
  if (!order?.planned) return null;

  const [hh, mm] = String(order.planned)
    .split(":")
    .map((part) => parseInt(part, 10));

  if (Number.isNaN(hh)) return null;

  const base = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
  const date = new Date(base);

  date.setHours(hh || 0, mm || 0, 0, 0);

  return date.getTime();
}

function etaFor(order: TrackedOrder, avgPickup: number, avgDelivery: number) {
  const baseEta = order.etaMin ?? (order.mode === "pickup" ? avgPickup : avgDelivery);
  const adjust = toNum(order.etaAdjustMin, 0);

  return Math.max(1, toNum(baseEta, order.mode === "pickup" ? avgPickup : avgDelivery) + adjust);
}

function acceptedStartMs(order: TrackedOrder) {
  const meta = order?.meta && typeof order.meta === "object" ? order.meta : {};
  const accepted = toMs(
    meta?.acceptedAt ??
      meta?.etaConfirmedAt ??
      meta?.acceptedTimestamp ??
      null,
    0,
  );

  return accepted > 0 ? accepted : null;
}

function remainingMinutes(
  order: TrackedOrder,
  avgPickup: number,
  avgDelivery: number,
  tz: string,
) {
  if (order.status === "done" || order.status === "cancelled") return 0;

  const nowMs = Date.now();
  const planned = plannedStartMs(order, tz);

  // "planned" is the promised pickup/delivery target time. Do not add the ETA
  // a second time; TV already counts directly toward this target.
  if (planned && planned > nowMs) {
    return Math.max(0, Math.floor((planned - nowMs) / 60_000));
  }

  const eta = etaFor(order, avgPickup, avgDelivery);
  const start = acceptedStartMs(order) ?? order.ts ?? nowMs;
  const end = start + eta * 60_000;

  return Math.max(0, Math.floor((end - nowMs) / 60_000));
}

function prettyDeliveryLine(order: TrackedOrder) {
  const direct =
    order.addressLine ||
    order.customer?.addressLine ||
    order.customer?.address ||
    "";

  const raw = String(direct || "");
  const parts = raw.split("|").map((part) => part.trim());
  const streetHouse = parts[0] || "";
  const zipMatch = (parts[1] || raw).match(/\b\d{5}\b/);
  const zip = zipMatch ? zipMatch[0] : order.customer?.zip || order.customer?.plz || "";

  return [zip, streetHouse].filter(Boolean).join(" ");
}

function normalizeLivePos(value: any): LivePos | null {
  if (!value || typeof value !== "object") return null;

  const lat = Number(value.lat ?? value.latitude);
  const lng = Number(value.lng ?? value.lon ?? value.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    lat,
    lng,
    ts: Number.isFinite(Number(value.ts)) ? Number(value.ts) : undefined,
  };
}

function readDriverPos(orderId: string, order?: any): LivePos | null {
  const meta = order?.meta || {};
  const driver = order?.driver || meta?.driver || {};

  const fromOrder =
    normalizeLivePos(meta?.lastPos) ||
    normalizeLivePos(meta?.lastDriverPos) ||
    normalizeLivePos(meta?.driverPos) ||
    normalizeLivePos(meta?.position) ||
    normalizeLivePos(driver?.lastPos) ||
    normalizeLivePos(driver?.lastDriverPos) ||
    normalizeLivePos(driver?.driverPos) ||
    normalizeLivePos(driver?.position);

  if (fromOrder) return fromOrder;

  try {
    const raw = localStorage.getItem(`bb_driverpos_${cleanOrderId(orderId)}`);
    const parsed = raw ? JSON.parse(raw) : null;
    return normalizeLivePos(parsed);
  } catch {
    return null;
  }
}

function msAgoText(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));

  if (seconds < 60) return `${seconds} Sek.`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} Min.`;

  const hours = Math.floor(minutes / 60);
  return `${hours} Std.`;
}

function normalizeOrder(raw: any, fallbackId = ""): TrackedOrder | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const nested = raw.order && typeof raw.order === "object" ? raw.order : {};
  const item = raw.item && typeof raw.item === "object" ? raw.item : {};
  const source = Object.keys(nested).length ? nested : Object.keys(item).length ? item : raw;

  const customer =
    source.customer && typeof source.customer === "object"
      ? source.customer
      : raw.customer && typeof raw.customer === "object"
        ? raw.customer
        : {};

  const id = cleanOrderId(
    source.orderId ||
      source.id ||
      raw.orderId ||
      raw.id ||
      nested.orderId ||
      nested.id ||
      item.orderId ||
      item.id ||
      fallbackId,
  );

  if (!id) return null;

  const sourceMeta =
    source.meta && typeof source.meta === "object"
      ? source.meta
      : raw.meta && typeof raw.meta === "object"
        ? raw.meta
        : {};

  return {
    ...source,
    id,
    orderId: cleanOrderId(source.orderId || raw.orderId || id),
    ts: toMs(
      source.ts ??
        raw.ts ??
        source.createdAt ??
        raw.createdAt ??
        sourceMeta.createdAt ??
        sourceMeta.orderCreatedAt,
      Date.now(),
    ),
    createdAt: source.createdAt ?? raw.createdAt ?? sourceMeta.createdAt ?? null,
    updatedAt: source.updatedAt ?? raw.updatedAt ?? null,
    mode: normalizeMode(source.mode ?? raw.mode ?? sourceMeta.mode),
    status: normalizeStatus(
      source.status ??
        raw.status ??
        sourceMeta.statusManual ??
        sourceMeta.status ??
        source.legacyStatus ??
        source.statusLegacy ??
        raw.legacyStatus ??
        raw.statusLegacy,
    ),
    legacyStatus: source.legacyStatus ?? source.statusLegacy ?? raw.legacyStatus ?? undefined,
    etaMin:
      source.etaMin != null
        ? toNum(source.etaMin, 0)
        : raw.etaMin != null
          ? toNum(raw.etaMin, 0)
          : null,
    etaAdjustMin:
      source.etaAdjustMin != null
        ? toNum(source.etaAdjustMin, 0)
        : raw.etaAdjustMin != null
          ? toNum(raw.etaAdjustMin, 0)
          : sourceMeta.etaAdjustMin != null
            ? toNum(sourceMeta.etaAdjustMin, 0)
            : 0,
    planned: source.planned ?? raw.planned ?? null,
    customer,
    customerName: source.customerName ?? raw.customerName ?? customer.name ?? "",
    phone: source.phone ?? raw.phone ?? customer.phone ?? "",
    addressLine:
      source.addressLine ??
      raw.addressLine ??
      customer.addressLine ??
      customer.address ??
      "",
    note: source.note ?? raw.note ?? customer.note ?? customer.deliveryHint ?? "",
    items: Array.isArray(source.items)
      ? source.items
      : Array.isArray(raw.items)
        ? raw.items
        : [],
    total: source.total ?? raw.total,
    meta: sourceMeta,
    driver: source.driver ?? raw.driver ?? sourceMeta.driver ?? null,
    deliveryDestination:
      source.deliveryDestination &&
      Number.isFinite(Number(source.deliveryDestination.lat)) &&
      Number.isFinite(Number(source.deliveryDestination.lng))
        ? {
            lat: Number(source.deliveryDestination.lat),
            lng: Number(source.deliveryDestination.lng),
          }
        : raw.deliveryDestination &&
            Number.isFinite(Number(raw.deliveryDestination.lat)) &&
            Number.isFinite(Number(raw.deliveryDestination.lng))
          ? {
              lat: Number(raw.deliveryDestination.lat),
              lng: Number(raw.deliveryDestination.lng),
            }
          : null,
    doneAt: source.doneAt ?? raw.doneAt ?? sourceMeta.doneAt ?? null,
    cancelledAt: source.cancelledAt ?? raw.cancelledAt ?? sourceMeta.cancelledAt ?? null,
  };
}

function findOrderInArray(arr: any[], id: string): TrackedOrder | null {
  const target = cleanOrderId(id);

  for (const item of arr) {
    const rawId =
      item?.orderId ||
      item?.id ||
      item?.order?.orderId ||
      item?.order?.id ||
      item?.item?.orderId ||
      item?.item?.id;

    if (!sameOrderId(rawId, target)) continue;

    const normalized = normalizeOrder(item, target);
    if (normalized) return normalized;
  }

  return null;
}

function findOrderInPayload(payload: any, id: string): TrackedOrder | null {
  const target = cleanOrderId(id);

  const directCandidates = [
    payload?.order,
    payload?.item,
    payload?.result,
    payload?.data && !Array.isArray(payload.data) ? payload.data : null,
    payload,
  ];

  for (const candidate of directCandidates) {
    const normalized = normalizeOrder(candidate, target);

    if (
      normalized &&
      (sameOrderId(normalized.id, target) || sameOrderId(normalized.orderId, target))
    ) {
      return normalized;
    }
  }

  const arrays = [
    Array.isArray(payload?.data) ? payload.data : null,
    Array.isArray(payload?.orders) ? payload.orders : null,
    Array.isArray(payload?.items) ? payload.items : null,
    Array.isArray(payload?.list) ? payload.list : null,
    Array.isArray(payload?.allOrders) ? payload.allOrders : null,
    Array.isArray(payload?.doneOrders) ? payload.doneOrders : null,
    Array.isArray(payload) ? payload : null,
  ];

  for (const arr of arrays) {
    if (!Array.isArray(arr)) continue;

    const found = findOrderInArray(arr, target);
    if (found) return found;
  }

  return null;
}

async function fetchOrderFromDb(trackingToken: string): Promise<TrackedOrder | null> {
  const token = cleanTrackingToken(trackingToken);
  if (!token) return null;

  try {
    const res = await fetch("/api/track/lookup", {
      method: "GET",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "x-order-tracking-token": token,
      },
    });

    if (!res.ok) return null;

    const json = await res.json().catch(() => ({} as any));
    if (json?.ok === false) return null;

    return normalizeOrder(json?.order || json?.data || json?.item || json);
  } catch {
    return null;
  }
}

async function fetchTrackingPosition(trackingToken: string): Promise<LivePos | null> {
  const token = cleanTrackingToken(trackingToken);
  if (!token) return null;

  try {
    const res = await fetch("/api/track/by-order/current", {
      method: "GET",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "x-order-tracking-token": token,
      },
    });

    if (!res.ok) return null;

    const json = await res.json().catch(() => ({} as any));
    const last = json?.session?.last;
    const lat = Number(last?.lat);
    const lng = Number(last?.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    return {
      lat,
      lng,
      ts: Number.isFinite(Number(last?.ts))
        ? Number(last.ts)
        : Date.parse(String(json?.session?.updatedAt || "")) || Date.now(),
    };
  } catch {
    return null;
  }
}

/* ---- PAGE ---- */

export default function TrackDetailPage() {
  const router = useRouter();
  const params = useParams<{ id?: string }>();

  const idStr = cleanTrackingToken(decodeURIComponent(String(params?.id || "")));

  const [settingsTick, setSettingsTick] = useState(0);
  const settings = useMemo(() => readSettings() as any, [settingsTick]);

  const tz = appTZ(settings);
  const avgPickup = Number(settings?.hours?.avgPickupMinutes ?? 15);
  const avgDelivery = Number(settings?.hours?.avgDeliveryMinutes ?? 35);

  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [pos, setPos] = useState<LivePos | null>(null);
  const [now, setNow] = useState<number>(Date.now());
  const [loading, setLoading] = useState(true);
  const [notFoundOnce, setNotFoundOnce] = useState(false);
  const [routeInfo, setRouteInfo] = useState<TrackingRouteInfo | null>(null);

  useEffect(() => {
    const footer = document.querySelector("footer") as HTMLElement | null;
    const previous = footer?.style.display;

    if (footer) footer.style.display = "none";

    return () => {
      if (footer) footer.style.display = previous || "";
    };
  }, []);

  useEffect(() => {
    let stopped = false;

    (async () => {
      try {
        await fetchAndApplyRemoteSettings();
      } catch {}

      if (!stopped) setSettingsTick((tick) => tick + 1);
    })();

    return () => {
      stopped = true;
    };
  }, []);

  const applyOrderResult = useCallback(
    (fromDb: TrackedOrder | null, livePosition: LivePos | null, forceClear = false) => {
      setNow(Date.now());

      if (fromDb) {
        setOrder(fromDb);
        setPos(livePosition);
        setNotFoundOnce(false);
        return;
      }

      setOrder((prev) => {
        if (prev && !forceClear) {
          if (livePosition) setPos(livePosition);
          return prev;
        }

        setPos(null);
        return null;
      });

      setNotFoundOnce(true);
    },
    [],
  );

  const loadOrder = useCallback(
    async (showLoading = false) => {
      if (!idStr) return;

      if (showLoading) setLoading(true);

      const [fromDb, livePosition] = await Promise.all([
        fetchOrderFromDb(idStr),
        fetchTrackingPosition(idStr),
      ]);

      applyOrderResult(fromDb, livePosition, showLoading && !order);

      if (showLoading) setLoading(false);
    },
    [idStr, applyOrderResult, order],
  );

  useEffect(() => {
    let stopped = false;

    (async () => {
      setLoading(true);

      const [fromDb, livePosition] = await Promise.all([
        fetchOrderFromDb(idStr),
        fetchTrackingPosition(idStr),
      ]);

      if (stopped) return;

      applyOrderResult(fromDb, livePosition, true);
      setLoading(false);
    })();

    return () => {
      stopped = true;
    };
  }, [idStr, applyOrderResult]);

  useEffect(() => {
    if (!order?.id || !idStr) return;
    void bindGeneralPushToOrder(order.id, idStr);
  }, [order?.id, idStr]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      loadOrder(false);
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [loadOrder]);

  useEffect(() => {
    const refreshFromLocalOrDb = () => {
      loadOrder(false);
    };

    const onStorage = (event: StorageEvent) => {
      if (!event.key) return;

      if (
        event.key === `bb_driverpos_${idStr}` ||
        event.key === "bb_driverpos_ping"
      ) {
        refreshFromLocalOrDb();
      }
    };

    const onCustomDriverPos = () => {
      refreshFromLocalOrDb();
    };

    const onFocus = () => {
      loadOrder(false);
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("bb:driver-pos-ping", onCustomDriverPos as EventListener);
    window.addEventListener("focus", onFocus);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("bb:driver-pos-ping", onCustomDriverPos as EventListener);
      window.removeEventListener("focus", onFocus);
    };
  }, [idStr, loadOrder]);

  const leftMin = useMemo(
    () => (order ? remainingMinutes(order, avgPickup, avgDelivery, tz) : 0),
    [order, avgPickup, avgDelivery, tz, now],
  );

  const deliveryDestination = order?.deliveryDestination || null;
  const routeEtaMin =
    routeInfo && routeInfo.durationSeconds > 0
      ? Math.max(1, Math.ceil(routeInfo.durationSeconds / 60))
      : null;
  const displayEtaMin =
    order?.status === "out_for_delivery" &&
    routeEtaMin != null &&
    routeInfo?.etaReliable !== false
      ? routeEtaMin
      : leftMin;

  const lastSeenTxt = pos?.ts ? msAgoText(now - (pos.ts || 0)) : null;
  const displayId = order?.id || idStr;

  useEffect(() => {
    if (order?.status !== "out_for_delivery") {
      setRouteInfo(null);
    }
  }, [order?.status]);

  return (
    <main className="relative mx-auto max-w-4xl space-y-6 p-4 text-stone-100 antialiased sm:p-6">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(1200px_700px_at_10%_-10%,rgba(59,130,246,.18),transparent),radial-gradient(1000px_600px_at_90%_0%,rgba(16,185,129,.14),transparent),linear-gradient(180deg,#0b0f14_0%,#0f1318_50%,#0a0d11_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(80%_80%_at_50%_20%,transparent,rgba(0,0,0,.45))]" />
      </div>

      <div className="flex items-center justify-between">
        <button
          onClick={() => router.back()}
          className="rounded-md border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10"
        >
          ← Zurück
        </button>

        <button
          onClick={() => loadOrder(true)}
          className="rounded-md border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10"
        >
          Aktualisieren
        </button>
      </div>

      <header className="text-center">
        <img
          src="/logo-burger-brothers.webp"
          className="mx-auto h-14 w-14"
          alt="Burger Brothers"
        />
        <h1 className="mt-2 text-2xl font-bold">Bestellstatus</h1>
      </header>

      {loading ? (
        <section className={`rounded-2xl p-4 ${glass}`}>
          <div className="rounded-2xl border border-white/15 bg-white/5 p-4 text-stone-200">
            Bestellung wird geladen…
          </div>
        </section>
      ) : !order ? (
        <section className={`rounded-2xl p-4 ${glass}`}>
          <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 p-4 text-rose-200">
            <div className="mb-1 font-semibold">Bestellung nicht gefunden</div>
            <div>
              Der Tracking-Code konnte nicht gefunden werden oder ist abgelaufen.
            </div>
            {notFoundOnce && (
              <div className="mt-2 text-xs text-rose-100/80">
                Bitte prüfen Sie den persönlichen Tracking-Code oder versuchen Sie es später erneut.
              </div>
            )}
          </div>
        </section>
      ) : (
        <section className={`rounded-2xl p-4 ${glass}`}>
          {order.status === "done" && (
            <div className="mb-4 rounded-xl border border-emerald-400/40 bg-emerald-500/15 p-3 text-emerald-100">
              ✅ Bestellung <b>#{String(displayId)}</b> wurde zugestellt.
            </div>
          )}

          {order.status === "cancelled" && (
            <div className="mb-4 rounded-xl border border-rose-400/40 bg-rose-500/15 p-3 text-rose-100">
              Bestellung <b>#{String(displayId)}</b> wurde storniert.
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className={`rounded-2xl p-4 ${glass}`}>
              <div className="text-sm opacity-80">
                Bestellung <b>#{String(displayId)}</b>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className={`${chip} ${chipColor(order.status || "new")}`}>
                  {statusLabel[order.status || "new"]}
                </span>

                {order.status !== "done" && order.status !== "cancelled" && (
                  <span className={`${chip} border-sky-400/60 bg-sky-500/20 text-sky-100`}>
                    ETA: <b className="ml-1 tabular-nums">{pad2(displayEtaMin)}′</b>
                  </span>
                )}

                {lastSeenTxt && order.status !== "done" && order.status !== "cancelled" && (
                  <span className={`${chip} border-white/30 bg-white/10 text-white/90`}>
                    Zuletzt gesehen: <b className="ml-1">{lastSeenTxt}</b>
                  </span>
                )}
              </div>

              <div className="mt-3 space-y-1 text-sm text-stone-200/90">
                <div>
                  <b>Art:</b> {order.mode === "pickup" ? "Abholung" : "Lieferung"}
                </div>

                {order.planned && (
                  <div>
                    <b>Geplant:</b> {order.planned}
                  </div>
                )}
              </div>

              {order.status === "out_for_delivery" && (
                <div className="mt-3 rounded-xl border border-emerald-300/20 bg-emerald-500/10 p-3 text-sm text-emerald-100">
                  <div className="font-semibold">🚚 Ihre Bestellung ist unterwegs.</div>
                  {routeInfo && (
                    <div className="mt-1 text-xs text-emerald-100/80">
                      {routeInfo.etaReliable
                        ? `Noch ca. ${Math.max(1, Math.ceil(routeInfo.durationSeconds / 60))} Min.`
                        : routeInfo.etaReliabilityReason === "multiple_stops"
                          ? `${routeInfo.activeOrderCount} aktive Lieferstopps · direkte Route wird angezeigt.`
                          : `Live-Route aktiv · Fahrzeit ca. ${Math.max(1, Math.ceil(routeInfo.durationSeconds / 60))} Min.`}
                      {routeInfo.distanceMeters > 0
                        ? ` · ${(routeInfo.distanceMeters / 1000)
                            .toFixed(routeInfo.distanceMeters >= 10_000 ? 0 : 1)
                            .replace(".", ",")} km`
                        : ""}
                    </div>
                  )}
                </div>
              )}

              {order.status === "ready" && order.mode === "pickup" && (
                <div className="mt-3 text-sm text-emerald-200/90">
                  ✅ Bereit zur Abholung.
                </div>
              )}

              {order.status === "preparing" && (
                <div className="mt-3 text-sm text-amber-200/90">
                  🍔 Ihre Bestellung wird vorbereitet.
                </div>
              )}

              {order.status === "new" && (
                <div className="mt-3 text-sm text-sky-200/90">
                  📩 Ihre Bestellung ist eingegangen.
                </div>
              )}
            </div>

            {order.mode === "delivery" &&
              order.status !== "done" &&
              order.status !== "cancelled" && (
                order.status === "out_for_delivery" ? (
                  <GoogleDeliveryMap
                    trackingToken={idStr}
                    active
                    position={pos}
                    destination={deliveryDestination}
                    lastSeenText={lastSeenTxt}
                    onRouteInfo={setRouteInfo}
                  />
                ) : (
                  <div className={`grid min-h-[300px] place-items-center rounded-2xl p-6 text-center ${glass}`}>
                    <div>
                      <div className="text-4xl">🗺️</div>
                      <div className="mt-3 font-semibold text-white">
                        Live-Karte wird vorbereitet
                      </div>
                      <div className="mt-1 max-w-sm text-sm text-stone-300/80">
                        Sobald der Fahrer Ihre Bestellung übernimmt und losfährt,
                        sehen Sie hier seine Live-Position und die Route zu Ihnen.
                      </div>
                    </div>
                  </div>
                )
              )}
          </div>
        </section>
      )}
    </main>
  );
}
