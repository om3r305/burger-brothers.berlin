// app/track/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { readAllOrders, StoredOrder, OrderStatus } from "@/lib/orders";
import { readSettings } from "@/lib/settings";

/* ---- UI helpers ---- */
const glass =
  "backdrop-blur-xl bg-white/[0.06] border border-white/15 shadow-[inset_0_1px_0_0_rgba(255,255,255,.20)] ring-1 ring-black/10";
const chip = "px-2.5 py-1 rounded-full border font-semibold text-[11px] tracking-wide";
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
    case "new": return "border-sky-400/60 bg-sky-500/20 text-sky-100";
    case "preparing": return "border-amber-400/60 bg-amber-500/20 text-amber-100";
    case "ready": return "border-emerald-400/60 bg-emerald-500/20 text-emerald-100";
    case "out_for_delivery": return "border-indigo-400/60 bg-indigo-500/20 text-indigo-100";
    case "done": return "border-lime-400/60 bg-lime-500/20 text-lime-100";
    case "cancelled": return "border-rose-400/60 bg-rose-500/20 text-rose-100";
  }
}

/* ---- time/ETA ---- */
const pad2 = (n:number)=> (n<10?`0${n}`:String(n));
function appTZ(s:any){ return String(s?.hours?.timezone || s?.hours?.tz || "Europe/Berlin"); }
function plannedStartMs(o:StoredOrder, tz:string){
  if (!o?.planned) return null;
  const [hh,mm]=String(o.planned).split(":").map(x=>parseInt(x,10));
  if (Number.isNaN(hh)) return null;
  const base = new Date(new Date().toLocaleString("en-US",{ timeZone: tz }));
  const d = new Date(base); d.setHours(hh||0, mm||0, 0, 0); return d.getTime();
}
function etaFor(o:StoredOrder, avgPickup:number, avgDelivery:number){
  return o.etaMin ?? (o.mode==="pickup"?avgPickup:avgDelivery);
}
function remainingMinutes(o:StoredOrder, avgPickup:number, avgDelivery:number, tz:string){
  const eta = etaFor(o, avgPickup, avgDelivery);
  const p = plannedStartMs(o, tz);
  const start = p && p > Date.now() ? p : o.ts || Date.now();
  const end = start + eta*60_000;
  return Math.max(0, Math.floor((end - Date.now())/60_000));
}

/* ---- address + pos ---- */
function prettyDeliveryLine(o: StoredOrder) {
  const raw = String(o?.customer?.address || "");
  const parts = raw.split("|").map(s => s.trim());
  const streetHouse = parts[0] || "";
  const zipMatch = (parts[1] || raw).match(/\b\d{5}\b/);
  const zip = zipMatch ? zipMatch[0] : "";
  return [zip, streetHouse].filter(Boolean).join(" ");
}

type LivePos = { lat:number; lng:number; ts?:number };
function readDriverPos(orderId: string, order?: any): LivePos | null {
  try {
    const ls = localStorage.getItem(`bb_driverpos_${orderId}`);
    if (ls) {
      const v = JSON.parse(ls);
      if (typeof v?.lat === "number" && typeof v?.lng === "number") return v;
    }
  } catch {}
  const fromOrder = order?.meta?.lastPos || order?.driver?.lastPos || null;
  if (fromOrder && typeof fromOrder.lat === "number" && typeof fromOrder.lng === "number") return fromOrder;
  return null;
}
function osmEmbedUrl(lat:number, lng:number, zoom=15, bust?:number) {
  const d = 0.01;
  const bbox = `${lng-d},${lat-d},${lng+d},${lat+d}`;
  const cache = bust ? `&t=${bust}` : "";
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}&zoom=${zoom}${cache}`;
}
function msAgoText(ms:number) {
  const s = Math.max(0, Math.floor(ms/1000));
  if (s < 60) return `${s} Sek.`;
  const m = Math.floor(s/60);
  if (m < 60) return `${m} Min.`;
  const h = Math.floor(m/60);
  return `${h} Std.`;
}

/* ---- PAGE ---- */
export default function TrackDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();

  // footer gizle
  useEffect(() => {
    const el = document.querySelector("footer") as HTMLElement | null;
    const prev = el?.style.display;
    if (el) el.style.display = "none";
    return () => { if (el) el.style.display = prev || ""; };
  }, []);

  const idStr = decodeURIComponent((params?.id || "").trim());
  const settings = readSettings() as any;
  const tz = appTZ(settings);
  const avgPickup = Number(settings?.hours?.avgPickupMinutes ?? 15);
  const avgDelivery = Number(settings?.hours?.avgDeliveryMinutes ?? 35);

  const [order, setOrder] = useState<StoredOrder | null>(null);
  const [pos, setPos] = useState<LivePos | null>(null);
  const [now, setNow] = useState<number>(Date.now()); // “son görüldü” & ETA tazelemek için

  // ilk yüklemede oku
  useEffect(() => {
    const all = readAllOrders() || [];
    const o = all.find(x => String(x.id).toLowerCase() === idStr.toLowerCase()) || null;
    setOrder(o);
    setPos(o ? readDriverPos(String(o.id), o) : null);
  }, [idStr]);

  // ➜ Otomatik yenileme: hem sipariş hem pos (her 5 sn)
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      const all = readAllOrders() || [];
      const o = all.find(x => String(x.id).toLowerCase() === idStr.toLowerCase()) || null;
      setOrder(o);
      setPos(o ? readDriverPos(String(o?.id || idStr), o) : null);
    }, 5000);
    return () => clearInterval(t);
  }, [idStr]);

  // ➜ Anında senkron: driver uygulaması localStorage’a yazınca yakala
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (e.key === `bb_driverpos_${idStr}` || e.key === "bb_driverpos_ping") {
        const all = readAllOrders() || [];
        const o = all.find(x => String(x.id).toLowerCase() === idStr.toLowerCase()) || null;
        setOrder(o);
        setPos(o ? readDriverPos(String(o?.id || idStr), o) : null);
        setNow(Date.now());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [idStr]);

  const leftMin = useMemo(
    () => order ? remainingMinutes(order, avgPickup, avgDelivery, tz) : 0,
    [order, avgPickup, avgDelivery, tz, now]
  );

  // Harita URL + cache-buster; iframe’i değişen key ile zorla rerender
  const mapUrl = useMemo(() => {
    if (!order || order.status === "done") return ""; // teslimde haritayı sakla
    if (pos) return osmEmbedUrl(pos.lat, pos.lng, 15, pos.ts || now);
    return "https://www.openstreetmap.org/export/embed.html?bbox=13.35,52.48,13.55,52.57&layer=mapnik&zoom=12";
  }, [order, pos, now]);

  const lastSeenTxt = pos?.ts ? msAgoText(now - (pos.ts || 0)) : null;

  return (
    <main className={"relative mx-auto max-w-4xl p-4 sm:p-6 space-y-6 text-stone-100 antialiased"}>
      {/* bg */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(1200px_700px_at_10%_-10%,rgba(59,130,246,.18),transparent),radial-gradient(1000px_600px_at_90%_0%,rgba(16,185,129,.14),transparent),linear-gradient(180deg,#0b0f14_0%,#0f1318_50%,#0a0d11_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(80%_80%_at_50%_20%,transparent,rgba(0,0,0,.45))]" />
      </div>

      {/* üst bar + geri butonu */}
      <div className="flex items-center justify-between">
        <button
          onClick={()=>router.back()}
          className="rounded-md border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10"
        >
          ← Zurück
        </button>
      </div>

      <header className="text-center">
        <img src="/logo-burger-brothers.png" className="mx-auto h-14 w-14" alt="Burger Brothers" />
        <h1 className="mt-2 text-2xl font-bold">Bestellstatus</h1>
      </header>

      {!order ? (
        <section className={`p-4 rounded-2xl ${glass}`}>
          <div className="rounded-2xl p-4 border border-rose-400/40 bg-rose-500/10 text-rose-200">
            <div className="font-semibold mb-1">Bestellung nicht gefunden</div>
            <div>Die Nummer <b>#{idStr}</b> konnte nicht gefunden werden.</div>
          </div>
        </section>
      ) : (
        <section className={`p-4 rounded-2xl ${glass}`}>
          {/* teslim edilmişse bilgi bandı */}
          {order.status === "done" && (
            <div className="mb-4 rounded-xl border border-emerald-400/40 bg-emerald-500/15 p-3 text-emerald-100">
              ✅ Bestellung <b>#{String(order.id).toUpperCase()}</b> wurde zugestellt.
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* sol */}
            <div className={`rounded-2xl p-4 ${glass}`}>
              <div className="text-sm opacity-80">Bestellung <b>#{String(order.id).toUpperCase()}</b></div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className={`${chip} ${chipColor(order.status || "new")}`}>
                  {statusLabel[order.status || "new"]}
                </span>
                {order.status !== "done" && (
                  <span className={`${chip} border-sky-400/60 bg-sky-500/20 text-sky-100`}>
                    ETA (Plan): <b className="tabular-nums ml-1">{pad2(leftMin)}′</b>
                  </span>
                )}
                {lastSeenTxt && order.status !== "done" && (
                  <span className={`${chip} border-white/30 bg-white/10 text-white/90`}>
                    Zuletzt gesehen: <b className="ml-1">{lastSeenTxt}</b>
                  </span>
                )}
              </div>

              <div className="mt-3 text-stone-200/90 text-sm space-y-1">
                {order.mode === "delivery" && <div><b>Adressese:</b> {prettyDeliveryLine(order)}</div>}
                <div><b>Kunde:</b> {order.customer?.name || "-"}</div>
              </div>

              {order.status === "out_for_delivery" && (
                <div className="mt-3 text-emerald-200/90 text-sm">🚚 Ihre Bestellung ist unterwegs.</div>
              )}
              {order.status === "ready" && order.mode === "pickup" && (
                <div className="mt-3 text-emerald-200/90 text-sm">✅ Bereit zur Abholung.</div>
              )}
            </div>

            {/* sağ: harita (teslim olduysa gizle) */}
            {order.status !== "done" && (
              <div className={`rounded-2xl overflow-hidden ${glass}`}>
                <div className="aspect-[4/3] w-full">
                  <iframe
                    key={pos?.ts || "nomap"}
                    title="Kartenansicht"
                    src={mapUrl}
                    className="w-full h-full border-0"
                  />
                </div>
                <div className="p-2 text-xs text-stone-300/80">
                  {pos
                    ? <>Letzte Fahrer-Position <b>{pos.lat.toFixed(5)}, {pos.lng.toFixed(5)}</b>{pos.ts ? <> · {new Date(pos.ts).toLocaleTimeString()}</> : null}</>
                    : <>Fahrer-Position noch nicht verfügbar.</>}
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
