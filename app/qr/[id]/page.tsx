// app/qr/[id]/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { StoredOrder, OrderStatus } from "@/lib/orders";
import { readSettings } from "@/lib/settings";

const metal =
  "bg-gradient-to-br from-stone-200/20 via-stone-100/10 to-stone-300/5 backdrop-blur border border-white/10";

/** Cihaz kimliği ve kayıtlı sürücü ismi için localStorage anahtarları */
const LS_DEVICE_ID = "bb_device_id";
const LS_DRIVER_NAME = "bb_driver_name";

/** Basit UUID */
function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Adressei Google Maps’e çevir */
function mapsUrlFromAddress(addr: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
}

/** Basit blur + son 2 hane gösterim */
function maskPhone(p?: string) {
  if (!p) return "-";
  const clean = p.replace(/\s+/g, "");
  const tail = clean.slice(-2);
  return "••• •• •• " + tail;
}

/** Ayarlardan PIN’i çek (fallback: 123456) */
function getDriverPin(): string {
  const s = readSettings() as any;
  return (
    s?.auth?.driverPin ??
    s?.admin?.driverPin ??
    s?.adminPassword ??
    "123456"
  ).toString();
}

function normalizeStatus(value: any): OrderStatus {
  const s = String(value || "").toLowerCase().trim();

  if (s === "received" || s === "eingegangen") return "new";
  if (s === "on_the_way" || s === "unterwegs") return "out_for_delivery";
  if (s === "delivered" || s === "completed" || s === "geliefert") return "done";
  if (s === "canceled" || s === "storniert") return "cancelled";

  if (
    s === "new" ||
    s === "preparing" ||
    s === "ready" ||
    s === "out_for_delivery" ||
    s === "done" ||
    s === "cancelled"
  ) {
    return s;
  }

  return "new";
}

function normalizeMode(value: any): "pickup" | "delivery" {
  const s = String(value || "").toLowerCase().trim();
  if (s === "pickup" || s === "abholung" || s === "apollo" || s === "apollon") {
    return "pickup";
  }
  return "delivery";
}

function normalizeOrder(raw: any): StoredOrder {
  const order = raw?.order && typeof raw.order === "object" ? raw.order : {};
  const customer = raw?.customer && typeof raw.customer === "object"
    ? raw.customer
    : order?.customer && typeof order.customer === "object"
      ? order.customer
      : {};

  const meta = raw?.meta && typeof raw.meta === "object"
    ? raw.meta
    : order?.meta && typeof order.meta === "object"
      ? order.meta
      : {};

  const ts =
    typeof raw?.ts === "number"
      ? raw.ts
      : raw?.ts
        ? new Date(raw.ts).getTime()
        : raw?.createdAt
          ? new Date(raw.createdAt).getTime()
          : Date.now();

  const items = Array.isArray(raw?.items)
    ? raw.items
    : Array.isArray(order?.items)
      ? order.items
      : [];

  const address =
    raw?.addressLine ||
    customer?.addressLine ||
    customer?.address ||
    "";

  return {
    ...(raw as StoredOrder),
    id: String(raw?.id || raw?.orderId || ""),
    orderId: String(raw?.orderId || raw?.id || ""),
    ts: Number.isFinite(ts) ? ts : Date.now(),
    mode: normalizeMode(raw?.mode || order?.mode),
    status: normalizeStatus(raw?.status || meta?.statusManual),
    plz: raw?.plz ?? customer?.plz ?? customer?.zip ?? null,
    customer: {
      ...customer,
      name: customer?.name ?? raw?.customerName ?? "",
      phone: customer?.phone ?? raw?.phone ?? "",
      address,
      addressLine: address,
    },
    items,
    merchandise: Number(raw?.merchandise ?? order?.merchandise ?? 0),
    discount: Number(raw?.discount ?? order?.discount ?? 0),
    surcharges: Number(raw?.surcharges ?? order?.surcharges ?? 0),
    total: Number(raw?.total ?? order?.total ?? 0),
    etaMin: raw?.etaMin ?? order?.etaMin ?? null,
    planned: raw?.planned ?? order?.planned ?? null,
    meta,
  } as StoredOrder;
}

async function fetchOrderById(id: string): Promise<StoredOrder | null> {
  const res = await fetch("/api/orders/list?scope=all&includeDone=1&take=1000", {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error("ORDER_LOAD_FAILED");
  }

  const data = await res.json();
  const rawList = Array.isArray(data)
    ? data
    : Array.isArray(data?.orders)
      ? data.orders
      : Array.isArray(data?.items)
        ? data.items
        : [];

  const found = rawList.find((o: any) => String(o?.id || o?.orderId) === String(id));
  return found ? normalizeOrder(found) : null;
}

async function writeOrderStatus(
  id: string,
  status: OrderStatus,
  driverName?: string
) {
  const first = await fetch("/api/orders/status", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id,
      status,
      by: driverName ? `driver:${driverName}` : "qr",
      driver: driverName || undefined,
    }),
  }).catch(() => null);

  if (first?.ok) return true;

  const fallback = await fetch("/api/admin/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "setStatus",
      id,
      status,
      by: driverName ? `driver:${driverName}` : "qr",
      note: driverName ? `Fahrer: ${driverName}` : undefined,
    }),
  }).catch(() => null);

  return Boolean(fallback?.ok);
}

export default function QRDriverPage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();

  const [order, setOrder] = useState<StoredOrder | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);

  const [driverName, setDriverName] = useState<string>("");
  const [hasDriverOnDevice, setHasDriverOnDevice] = useState(false);
  const [loading, setLoading] = useState(true);

  // Cihaz ID’si (kaydedilmemişse üret ve sakla)
  useEffect(() => {
    if (typeof window === "undefined") return;
    let id = localStorage.getItem(LS_DEVICE_ID);
    if (!id) {
      id = uid();
      localStorage.setItem(LS_DEVICE_ID, id);
    }
    const dn = localStorage.getItem(LS_DRIVER_NAME);
    if (dn) {
      setDriverName(dn);
      setHasDriverOnDevice(true);
    }
  }, []);

  const loadOrder = useCallback(async () => {
    try {
      setLoading(true);
      const found = await fetchOrderById(params.id);
      setOrder(found);
    } catch (error) {
      console.error("[qr] order load failed:", error);
      setOrder(null);
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  // Siparişi DB API’den oku
  useEffect(() => {
    loadOrder();
  }, [loadOrder]);

  const isClosed = useMemo(() => {
    if (!order) return true;
    return order.status === "done" || order.status === "cancelled";
  }, [order]);

  /* === PIN işlemleri === */
  const tryUnlock = () => {
    const good = getDriverPin();
    if (pinInput.trim() === good) {
      setUnlocked(true);
      setPinError(null);
      setPinInput("");
    } else {
      setPinError("Falsche PIN.");
    }
  };

  const saveDriverOnDevice = () => {
    const name = driverName.trim();
    if (!name) return;
    localStorage.setItem(LS_DRIVER_NAME, name);
    setHasDriverOnDevice(true);
  };

  /* === Sipariş güncelleme yardımcıları === */
  async function updateOrderStatus(nextStatus: OrderStatus) {
    if (!order) return;
    if (order.status === "done" || order.status === "cancelled") return;

    const previous = order;
    const next = { ...order, status: nextStatus, driver: driverName || (order as any).driver } as StoredOrder;

    setOrder(next);

    const ok = await writeOrderStatus(order.id, nextStatus, driverName);

    if (!ok) {
      console.error("[qr] status update failed:", order.id, nextStatus);
      setOrder(previous);
      return;
    }

    await loadOrder();
  }

  const setUnterwegs = () => {
    if (!order) return;

    const nextStatus =
      order.mode === "delivery" ? "out_for_delivery" : "ready";

    void updateOrderStatus(nextStatus);

    try {
      (navigator as any).vibrate?.(80);
    } catch {}
  };

  const setAbgeschlossen = () => {
    if (!order) return;

    const ok = window.confirm("Bestätigen Sie: Auftrag abgeschlossen?");
    if (!ok) return;

    void updateOrderStatus("done");

    try {
      (navigator as any).vibrate?.([50, 30, 50]);
    } catch {}

    // router.push("/tv");
  };

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center text-center p-6">
        <div className={`rounded-2xl p-6 border ${metal}`}>
          <div className="text-2xl font-bold">Auftrag wird geladen...</div>
          <div className="opacity-70 mt-2">
            Bitte kurz warten.
          </div>
        </div>
      </main>
    );
  }

  if (!order) {
    return (
      <main className="min-h-screen flex items-center justify-center text-center p-6">
        <div className={`rounded-2xl p-6 border ${metal}`}>
          <div className="text-2xl font-bold">Auftrag nicht gefunden</div>
          <div className="opacity-70 mt-2">
            Prüfen Sie die QR/ID: <span className="font-mono">#{params.id}</span>
          </div>
        </div>
      </main>
    );
  }

  if (isClosed) {
    return (
      <main className="min-h-screen flex items-center justify-center text-center p-6">
        <div className={`rounded-2xl p-6 border ${metal}`}>
          <div className="text-2xl font-bold">Nicht verfügbar</div>
          <div className="opacity-70 mt-2">
            Dieser Auftrag ist bereits geschlossen oder storniert.
          </div>
        </div>
      </main>
    );
  }

  const fullAddr = order.customer?.address || "";
  const maskedPhone = maskPhone(order.customer?.phone);
  const statusBadge =
    order.status === "out_for_delivery"
      ? "bg-indigo-500/30 text-indigo-100 border-indigo-400/60"
      : order.status === "preparing"
        ? "bg-amber-500/30 text-amber-100 border-amber-400/60"
        : order.status === "ready"
          ? "bg-emerald-500/30 text-emerald-100 border-emerald-400/60"
          : "bg-sky-500/30 text-sky-100 border-sky-400/60";

  return (
    <main className="mx-auto max-w-3xl w-full p-4 md:p-6 space-y-4">
      {/* Üst başlık */}
      <header className="flex items-center justify-between">
        <div className="text-xl md:text-2xl font-bold">
          Auftrag <span className="font-mono">#{order.id}</span>
        </div>
        <span
          className={`px-3 py-1.5 rounded-full border-2 text-sm font-semibold tracking-wide ${statusBadge}`}
        >
          {order.mode === "delivery" ? "Lieferung" : "Abholung"}
        </span>
      </header>

      {/* PIN kilidi */}
      {!unlocked && (
        <section className={`rounded-2xl p-4 border ${metal}`}>
          <div className="text-lg font-semibold mb-2">PIN-Verifizierung</div>
          <div className="text-sm opacity-80">
            Bitte PIN eingeben, um Kundendaten zu sehen.
          </div>
          <div className="mt-3 flex gap-2">
            <input
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              placeholder="PIN"
              inputMode="numeric"
              className="px-3 py-2 rounded-lg bg-stone-900 border border-white/10 outline-none w-40"
            />
            <button onClick={tryUnlock} className="card-cta">
              Entsperren
            </button>
          </div>
          {pinError && (
            <div className="text-rose-300 text-sm mt-2">{pinError}</div>
          )}

          {/* Blur ile bilgi ön-izlemesi */}
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-xl p-3 border border-white/10 bg-white/5">
              <div className="text-xs opacity-70">Kunde</div>
              <div className="blur-sm select-none">{order.customer?.name || "-"}</div>
              <div className="blur-sm select-none">{maskedPhone}</div>
            </div>
            {order.mode === "delivery" && (
              <div className="rounded-xl p-3 border border-white/10 bg-white/5">
                <div className="text-xs opacity-70">Adresse</div>
                <div className="blur-sm select-none line-clamp-2">
                  {fullAddr || "-"}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Kilit açıldıktan sonra görünür kısım */}
      {unlocked && (
        <>
          {/* Sürücü kayıt kutusu (bir kere) */}
          {!hasDriverOnDevice && (
            <section className={`rounded-2xl p-4 border ${metal}`}>
              <div className="text-lg font-semibold mb-2">Gerät als Fahrer speichern</div>
              <div className="text-sm opacity-80">
                Dieses Gerät einmal benennen; danach wird der Fahrername bei Aktionen mitgeschrieben.
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  value={driverName}
                  onChange={(e) => setDriverName(e.target.value)}
                  placeholder="Fahrername (z. B. Ali)"
                  className="px-3 py-2 rounded-lg bg-stone-900 border border-white/10 outline-none w-64"
                />
                <button onClick={saveDriverOnDevice} className="card-cta">
                  Speichern
                </button>
              </div>
            </section>
          )}

          {/* Müşteri & adres */}
          <section className={`rounded-2xl p-4 border ${metal}`}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div className="text-xs opacity-70">Kunde</div>
                <div className="text-base font-medium">
                  {order.customer?.name || "-"}
                </div>
                <div className="text-sm opacity-80">
                  {order.customer?.phone || "-"}
                </div>
              </div>

              {order.mode === "delivery" && (
                <div>
                  <div className="text-xs opacity-70">Adresse</div>
                  <div className="text-base font-medium break-words">
                    {fullAddr || "-"}
                  </div>
                  {fullAddr && (
                    <a
                      className="inline-block mt-2 btn-ghost"
                      href={mapsUrlFromAddress(fullAddr)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Google Maps öffnen
                    </a>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Aksiyon butonları */}
          <section className={`rounded-2xl p-4 border ${metal}`}>
            <div className="flex flex-wrap gap-3">
              <button onClick={setUnterwegs} className="btn-ghost">
                🚚 Unterwegs markieren
              </button>
              <button onClick={setAbgeschlossen} className="card-cta">
                ✅ Abgeschlossen
              </button>

              {driverName && (
                <span className="ml-auto text-sm opacity-80 self-center">
                  Fahrer: <b>{driverName}</b>
                </span>
              )}
            </div>
          </section>

          {/* Sipariş kalemleri */}
          <section className={`rounded-2xl p-4 border ${metal}`}>
            <div className="text-sm font-semibold mb-2">Artikel</div>
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
                  {order.items.map((it: any, i: number) => (
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
          </section>
        </>
      )}
    </main>
  );
}