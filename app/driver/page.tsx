"use client";

import DriverLiveTracker from "@/components/DriverLiveTracker";

import React, { useEffect, useMemo, useState } from "react";
import {
  readAllOrders,
  upsertOrder,
  setOrderStatus,
  StoredOrder,
} from "@/lib/orders";
import { readSettings } from "@/lib/settings";

type Driver = { id: string; name: string; password: string };
const DRIVERS_KEY = "bb_drivers_v1";
const CURRENT_DRIVER_KEY = "bb_current_driver_v1";
const REMEMBER_KEY = "bb_driver_remember";
const LASTNAME_KEY = "bb_driver_lastname";
const LASTPASS_KEY = "bb_driver_lastpass_v2";

/* basit obfuscation (güvenlik amacı değil; sadece gizleme) */
const SALT = "bb$kurier!2025";
function enc(s: string) { try { return btoa(unescape(encodeURIComponent(SALT + s))); } catch { return ""; } }
function dec(s: string) {
  try {
    const raw = decodeURIComponent(escape(atob(s || "")));
    return raw.startsWith(SALT) ? raw.slice(SALT.length) : "";
  } catch { return ""; }
}

/* helpers */
function readDrivers(): Driver[] { try { return JSON.parse(localStorage.getItem(DRIVERS_KEY) || "[]"); } catch { return []; } }
function getCurrentDriver(): Driver | null { try { return JSON.parse(localStorage.getItem(CURRENT_DRIVER_KEY) || "null"); } catch { return null; } }
function setCurrentDriver(d: Driver | null) { if (d) localStorage.setItem(CURRENT_DRIVER_KEY, JSON.stringify(d)); else localStorage.removeItem(CURRENT_DRIVER_KEY); }
function sanitizePhone(p?: string) { return (p || "").replace(/[^+\d]/g, ""); }
function mapsQuery(addr: string) { return addr ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}` : "https://www.google.com/maps"; }
function prettyDeliveryLine(o: StoredOrder) {
  const raw = String(o?.customer?.address || "");
  if (!raw) return "";
  const parts = raw.split("|").map(s => s.trim());
  if (parts.length >= 2) {
    const street = parts[0] || "";
    const zipMatch = (parts[1] || "").match(/\b\d{5}\b/);
    const zip = zipMatch ? zipMatch[0] : (parts[1] || "");
    return [zip, street].filter(Boolean).join(" ");
  }
  return raw;
}
function todayStartMs(){ const d=new Date(); d.setHours(0,0,0,0); return d.getTime(); }
function clearPosKey(id: string|number){ try{ localStorage.removeItem(`bb_driverpos_${id}`); }catch{} }

const glass =
  "backdrop-blur-xl bg-white/5 border border-white/15 " +
  "shadow-[inset_0_1px_0_0_rgba(255,255,255,.18)] ring-1 ring-black/20";

/* ---- Zaman/ETA yardımcıları ---- */
const pad2 = (n:number)=> (n<10?`0${n}`:String(n));
function appTZ(s:any){ return String(s?.hours?.timezone || s?.hours?.tz || "Europe/Berlin"); }
function plannedStartMs(o:StoredOrder, tz:string){
  if (!o?.planned) return null;
  const [hh,mm]=String(o.planned).split(":").map(x=>parseInt(x,10));
  if (Number.isNaN(hh)) return null;
  const base = new Date(new Date().toLocaleString("en-US",{ timeZone: tz }));
  const d = new Date(base); d.setHours(hh||0, mm||0, 0, 0); return d.getTime();
}
function etaFor(o:StoredOrder, avgPickup:number, avgDelivery:number){ return o.etaMin ?? (o.mode==="pickup"?avgPickup:avgDelivery); }
function remainingMinutes(o:StoredOrder, avgPickup:number, avgDelivery:number, tz:string){
  const eta = etaFor(o, avgPickup, avgDelivery);
  const p = plannedStartMs(o, tz);
  const start = p && p > Date.now() ? p : o.ts || Date.now();
  const end = start + eta*60_000;
  return Math.max(0, Math.floor((end - Date.now())/60_000));
}

export default function DriverPage() {
  // footer’ı sadece bu sayfada gizle
  useEffect(() => {
    const footer = document.querySelector("footer") as HTMLElement | null;
    const prev = footer?.style.display || "";
    if (footer) footer.style.display = "none";
    return () => { if (footer) footer.style.display = prev; };
  }, []);

  // ui
  const [tab, setTab] = useState<"new"|"mine">("new");
  const [loading, setLoading] = useState(false);

  // auth
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [current, setCurrent] = useState<Driver | null>(null);
  const [remember, setRemember] = useState(true);
  const [loginName, setLoginName] = useState("");
  const [loginPass, setLoginPass] = useState("");

  // data
  const [orders, setOrders] = useState<StoredOrder[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});

  // settings
  const settings = readSettings() as any;
  const tz = appTZ(settings);
  const avgPickup = Number(settings?.hours?.avgPickupMinutes ?? 15);
  const avgDelivery = Number(settings?.hours?.avgDeliveryMinutes ?? 35);

  // küçük tick
  const [,setTick]=useState(0);
  useEffect(()=>{ const id=setInterval(()=>setTick(x=>x+1), 30_000); return ()=>clearInterval(id); },[]);

  /* init */
  useEffect(() => {
    setDrivers(readDrivers());

    const r = localStorage.getItem(REMEMBER_KEY);
    if (r !== null) setRemember(r === "1");

    const ln = localStorage.getItem(LASTNAME_KEY);
    if (ln) setLoginName(ln);

    const lp = localStorage.getItem(LASTPASS_KEY);
    if (lp && r === "1") setLoginPass(dec(lp));

    const cur = getCurrentDriver();
    if (cur) setCurrent(cur);

    const t = setInterval(() => refresh(), 3000);
    refresh();
    return () => clearInterval(t);
  }, []);

  /* ➜ Login ekranına dönünce şifre & kullanıcı adını tekrar doldur */
  useEffect(() => {
    if (!current) {
      const r = localStorage.getItem(REMEMBER_KEY) === "1";
      const ln = localStorage.getItem(LASTNAME_KEY);
      const lp = localStorage.getItem(LASTPASS_KEY);
      if (ln) setLoginName(ln);
      if (r && lp) setLoginPass(dec(lp));
    }
  }, [current]);

  function refresh() {
    const all = readAllOrders() || [];
    setOrders(all);
  }

  /* derived */
  const pending = useMemo(() =>
    orders
      .filter(o =>
        o.mode === "delivery" &&
        o.status !== "out_for_delivery" &&
        o.status !== "done" &&
        o.status !== "cancelled"
      )
      .sort((a,b) => (a.ts||0) - (b.ts||0))
  , [orders]);

  const mine = useMemo(() => {
    if (!current) return [];
    return orders
      .filter(o => o.driver?.id === current.id &&
        (o.status === "out_for_delivery" || o.status === "preparing" || o.status === "ready"))
      .sort((a,b) => (a.ts||0) - (b.ts||0));
  }, [orders, current]);

  const eod = useMemo(() => {
    if (!current) return { count: 0, total: 0 };
    const start = todayStartMs();
    const list = orders.filter(o =>
      o.driver?.id === current.id && o.deliveredAt && Number(o.deliveredAt) >= start && o.status === "done"
    );
    const count = list.length;
    const total = list.reduce((s, o) =>
      s + Number(o.items?.reduce?.((a:any,b:any)=> a + Number(b.price||0) * Number(b.qty||1), 0) || 0)
    , 0);
    return { count, total };
  }, [orders, current]);

  /* auth actions */
  function handleLogin(e?: React.FormEvent) {
    e?.preventDefault();
    const drv = drivers.find(d => d.name === loginName && d.password === loginPass);
    if (!drv) return alert("Ungültiger Benutzer / Passwort. Bitte Admin kontaktieren.");

    setCurrent(drv);

    localStorage.setItem(LASTNAME_KEY, loginName || drv.name);

    if (remember) {
      setCurrentDriver(drv);
      localStorage.setItem(REMEMBER_KEY, "1");
      localStorage.setItem(LASTPASS_KEY, enc(loginPass)); // şifreyi sakla
    } else {
      setCurrentDriver(null);
      localStorage.setItem(REMEMBER_KEY, "0");
      localStorage.removeItem(LASTPASS_KEY);
    }

    setLoginPass("");
  }

  function handleLogout() {
    // çıkarken: bana ait aktif işlerin konum anahtarlarını temizle
    try {
      const me = getCurrentDriver();
      const active = orders.filter(o =>
        o.driver?.id === me?.id && (o.status === "out_for_delivery" || o.status === "preparing" || o.status === "ready")
      );
      for (const o of active) clearPosKey(o.id);
    } catch {}
    setCurrent(null);
    setCurrentDriver(null);
  }

  /* selection */
  function toggleSelect(id: string|number) {
    setSelected(s => ({ ...s, [String(id)]: !s[String(id)] }));
  }

  /* order actions */
  async function claimSelected() {
    if (!current) return alert("Bitte zuerst anmelden.");
    const ids = Object.keys(selected).filter(k => selected[k]);
    if (!ids.length) return alert("Keine Auswahl.");
    setLoading(true);
    try {
      for (const id of ids) {
        const o = orders.find(x => String(x.id) === id);
        if (!o) continue;
        if (o.driver && o.driver.id && o.driver.id !== current.id) continue;
        await upsertOrder({ ...o, driver: { id: current.id, name: current.name }, claimedAt: Date.now() });
        await setOrderStatus(o.id, "out_for_delivery");
      }
      setSelected({});
      refresh();
    } finally { setLoading(false); }
  }

  async function claimOne(o: StoredOrder) {
    if (!current) return alert("Bitte zuerst anmelden.");
    if (o.driver && o.driver.id && o.driver.id !== current.id)
      return alert("Dieser Auftrag ist bereits zugewiesen.");
    await upsertOrder({ ...o, driver: { id: current.id, name: current.name }, claimedAt: Date.now() });
    await setOrderStatus(o.id, "out_for_delivery");
    refresh();
  }

  async function releaseOne(o: StoredOrder) {
    if (!current) return;
    if (!o.driver || o.driver.id !== current.id)
      return alert("Dieser Auftrag gehört nicht Ihnen.");

    // konum anahtarını ve yedeğini temizle
    clearPosKey(o.id);
    await upsertOrder({ ...o, driver: null, claimedAt: null, meta: { ...(o.meta||{}), lastPos: null } });
    await setOrderStatus(o.id, "preparing");
    refresh();
  }

  async function finishOne(o: StoredOrder) {
    if (!current) return;
    if (!confirm("Bestätigung: Lieferung abgeschlossen?")) return;

    // konum anahtarını ve yedeğini temizle
    clearPosKey(o.id);
    await upsertOrder({ ...o, driver: { id: current.id, name: current.name }, deliveredAt: Date.now(), meta: { ...(o.meta||{}), lastPos: null } });
    await setOrderStatus(o.id, "done");
    refresh();
  }

  function callCustomer(phone?: string) {
    const p = sanitizePhone(phone);
    if (!p) return alert("Keine Telefonnummer.");
    window.location.href = `tel:${p}`;
  }
  function openMaps(o: StoredOrder) {
    const addr = prettyDeliveryLine(o) || (o.customer?.address || "");
    window.open(mapsQuery(addr), "_blank");
  }

  /* küçük zaman rozetleri */
  function TimeBadge({ o }: { o: StoredOrder }) {
    const left = remainingMinutes(o, avgPickup, avgDelivery, tz);
    const pMs = plannedStartMs(o, tz);
    const plannedFuture = !!pMs && pMs > Date.now();
    const created = o.ts ? new Date(o.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "-";
    return (
      <div className="text-xs mt-1 flex gap-3 text-stone-300/90">
        {plannedFuture ? (
          <span className="px-2 py-0.5 rounded-full border border-amber-400/40 bg-amber-500/15">
            Geplant: <b>{String(o.planned)}</b>
          </span>
        ) : (
          <span className="px-2 py-0.5 rounded-full border border-sky-400/40 bg-sky-500/15">
            Rest: <b>{pad2(left)}′</b>
          </span>
        )}
        <span className="opacity-80">Erstellt: {created}</span>
      </div>
    );
  }

  /* para formatı + detay akordeon */
  function formatMoney(n: number | undefined) {
    const v = Number.isFinite(Number(n)) ? Number(n) : 0;
    return `${v.toFixed(2)}€`;
  }
  function OrderWithDetails({ o }: { o: StoredOrder }) {
    const open = !!openMap[String(o.id)];
    const items = Array.isArray(o.items) ? o.items : [];
    const sum = items.reduce((s:any, it:any)=> s + Number(it.price||0)*Number(it.qty||1), 0);

    return (
      <div className={`rounded-xl p-4 ${glass}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="font-semibold">#{o.id} · Lieferung</div>
            <div className="text-sm">{o.customer?.name || "-"} · {o.customer?.phone || "-"}</div>
            <div className="text-sm opacity-80 mt-1">{prettyDeliveryLine(o)}</div>
            <TimeBadge o={o} />

            <button
              className="mt-2 text-sm underline underline-offset-4 opacity-90"
              onClick={()=>setOpenMap(m=>({ ...m, [String(o.id)]: !open }))}
            >
              {open ? "Details verbergen" : "Details anzeigen"}
            </button>

            {open && (
              <div className="mt-2 rounded-lg border border-white/10 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-white/5">
                    <tr>
                      <th className="p-2 text-left">Artikel</th>
                      <th className="p-2 text-right">Menge</th>
                      <th className="p-2 text-right">Summe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it:any, i:number) => {
                      const qty = Number(it.qty || 1);
                      const line = qty * Number(it.price || 0);
                      const add = Array.isArray(it.add) ? it.add : [];
                      const rm = Array.isArray(it.rm) ? it.rm : [];
                      const note = it.note ? String(it.note) : "";
                      return (
                        <tr key={i} className="border-t border-white/10 align-top">
                          <td className="p-2">
                            <div className="font-medium">{it.name}</div>
                            {note && <div className="text-xs opacity-90 mt-0.5">Hinweisiz: {note}</div>}
                            {add.length>0 && <div className="text-xs opacity-70">Extras: {add.map((a:any)=>a?.label||a?.name).filter(Boolean).join(", ")}</div>}
                            {rm.length>0 && <div className="text-xs opacity-70">Ohne: {rm.join(", ")}</div>}
                          </td>
                          <td className="p-2 text-right">{qty}</td>
                          <td className="p-2 text-right">{formatMoney(line)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-white/10">
                      <td className="p-2 text-right font-semibold" colSpan={2}>Gesamt</td>
                      <td className="p-2 text-right font-semibold">{formatMoney(sum)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 items-stretch min-w-[220px]">
            <div className="flex gap-2">
              <button className="flex-1 rounded-md px-3 py-1 border border-white/20 hover:bg-white/10" onClick={()=>callCustomer(o.customer?.phone)}>Anrufen</button>
              <button className="flex-1 rounded-md px-3 py-1 border border-white/20 hover:bg-white/10" onClick={()=>openMaps(o)}>Karte</button>
            </div>
            <div className="flex gap-2">
              <button className="flex-1 rounded-md px-3 py-1 bg-emerald-400 text-black font-semibold hover:bg-emerald-300" onClick={()=>finishOne(o)}>Fertig</button>
              <button className="flex-1 rounded-md px-3 py-1 border border-white/20 hover:bg-white/10" onClick={()=>releaseOne(o)}>Zurückgeben</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ───────── RENDER ───────── */
  if (!current) {
    return (
      <main className="min-h-screen text-stone-100 antialiased">
        <div className="pointer-events-none fixed inset-0 -z-10">
          <div className="absolute inset-0 bg-[radial-gradient(1200px_700px_at_10%_-10%,rgba(59,130,246,.18),transparent),radial-gradient(1000px_600px_at_90%_0%,rgba(16,185,129,.14),transparent),linear-gradient(180deg,#0b0f14_0%,#0f1318_50%,#0a0d11_100%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(80%_80%_at_50%_20%,transparent,rgba(0,0,0,.45))]" />
        </div>

        <div className="max-w-md mx-auto px-4 py-16">
          <div className={`rounded-2xl p-6 ${glass}`}>
            <div className="text-center mb-6">
              <img src="/logo-burger-brothers.png" className="mx-auto h-16 w-16" alt="" />
              <h1 className="mt-3 text-2xl font-bold">Fahrer-Login</h1>
              <p className="text-sm text-stone-300/90 mt-1">Bitte mit vom Admin vergebenen Zugangsdaten anmelden.</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-3">
              <input
                className="w-full rounded-md px-3 py-2 bg-white/10 border border-white/20 outline-none focus:ring-2 focus:ring-white/30"
                placeholder="Benutzername"
                value={loginName}
                onChange={(e)=>{
                  setLoginName(e.target.value);
                  localStorage.setItem(LASTNAME_KEY, e.target.value || "");
                }}
                autoComplete="username"
              />
              <input
                type="password"
                className="w-full rounded-md px-3 py-2 bg-white/10 border border-white/20 outline-none focus:ring-2 focus:ring-white/30"
                placeholder="Passwort"
                value={loginPass}
                onChange={(e)=>{
                  setLoginPass(e.target.value);
                  if (remember) localStorage.setItem(LASTPASS_KEY, enc(e.target.value));
                }}
                autoComplete="current-password"
              />

              <label className="flex items-center gap-2 text-sm opacity-90">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e)=>{
                    setRemember(e.target.checked);
                    localStorage.setItem(REMEMBER_KEY, e.target.checked ? "1" : "0");
                    if (e.target.checked) {
                      localStorage.setItem(LASTPASS_KEY, enc(loginPass));
                    } else {
                      localStorage.removeItem(LASTPASS_KEY);
                    }
                  }}
                />
                Angemeldet bleiben
              </label>

              <button
                type="submit"
                className="w-full rounded-md py-2 font-semibold bg-amber-500 hover:bg-amber-400 text-black transition"
              >
                Anmelden
              </button>
            </form>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen text-stone-100 antialiased">
      {/* Konum yayını artık sadece bu component’te */}
      <DriverLiveTracker />

      {/* background */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(1200px_700px_at_10%_-10%,rgba(59,130,246,.18),transparent),radial-gradient(1000px_600px_at_90%_0%,rgba(16,185,129,.14),transparent),linear-gradient(180deg,#0b0f14_0%,#0f1318_50%,#0a0d11_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(80%_80%_at_50%_20%,transparent,rgba(0,0,0,.45))]" />
      </div>

      <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
        {/* header */}
        <div className={`rounded-2xl p-4 flex items-center justify-between ${glass}`}>
          <div>
            <div className="text-lg font-semibold">Willkommen, {current.name}</div>
            <div className="text-sm text-stone-300/90">Nur Lieferaufträge werden angezeigt.</div>
          </div>
          <div className="text-right">
            <div className="text-sm">Heute: <b>{eod.count}</b> Lieferungen</div>
            <div className="text-sm">Umsatz: <b>{eod.total.toFixed(2)}€</b></div>
            <button className="mt-2 text-sm px-3 py-1 rounded-md border border-white/20 hover:bg-white/10" onClick={handleLogout}>Abmelden</button>
          </div>
        </div>

        {/* tabs */}
        <div className={`rounded-2xl p-2 ${glass}`}>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={()=>setTab("new")}
              className={`rounded-md py-2 font-medium ${tab==="new" ? "bg-white/20" : "opacity-80 hover:bg-white/10"}`}
            >
              Neu ({pending.length})
            </button>
            <button
              onClick={()=>setTab("mine")}
              className={`rounded-md py-2 font-medium ${tab==="mine" ? "bg-white/20" : "opacity-80 hover:bg-white/10"}`}
            >
              Meine ({mine.length})
            </button>
          </div>
        </div>

        {/* content */}
        <section className="space-y-3">
          {tab === "new" ? (
            <>
              {pending.length === 0 ? (
                <div className={`rounded-xl p-4 text-sm text-stone-300/90 ${glass}`}>Keine neuen Aufträge.</div>
              ) : (
                <>
                  <div className="flex justify-end">
                    <button
                      onClick={claimSelected}
                      disabled={loading}
                      className="rounded-md px-4 py-2 font-semibold bg-indigo-400 text-black hover:bg-indigo-300"
                      title="Ausgewählte übernehmen"
                    >
                      ＋ Übernehmen
                    </button>
                  </div>
                  {pending.map(o => (
                    <div key={String(o.id)} className={`rounded-xl p-4 ${glass}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="font-semibold">#{o.id} · Lieferung</div>
                          <div className="text-sm">{o.customer?.name || "-"} · {o.customer?.phone || "-"}</div>
                          <div className="text-sm opacity-80 mt-1">{prettyDeliveryLine(o)}</div>
                          <TimeBadge o={o} />
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <label className="text-sm flex items-center gap-2 opacity-90">
                            <input
                              type="checkbox"
                              checked={!!selected[String(o.id)]}
                              onChange={()=>toggleSelect(o.id)}
                            />
                            Auswählen
                          </label>
                          <button
                            className="rounded-md px-3 py-1 border border-white/20 hover:bg-white/10"
                            onClick={()=>claimOne(o)}
                            title="Übernehmen"
                          >
                            ＋
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </>
          ) : (
            <>
              {mine.length === 0 ? (
                <div className={`rounded-xl p-4 text-sm text-stone-300/90 ${glass}`}>Keine übernommenen Aufträge.</div>
              ) : mine.map(o => (
                <OrderWithDetails key={String(o.id)} o={o} />
              ))}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
