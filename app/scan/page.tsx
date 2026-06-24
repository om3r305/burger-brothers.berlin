// app/scan/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { StoredOrder, OrderStatus } from "@/lib/orders";

const PIN = "1905";

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
  const customer =
    raw?.customer && typeof raw.customer === "object"
      ? raw.customer
      : order?.customer && typeof order.customer === "object"
        ? order.customer
        : {};

  const meta =
    raw?.meta && typeof raw.meta === "object"
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

async function fetchOrder(id: string): Promise<StoredOrder | null> {
  const res = await fetch("/api/orders/list?scope=all&includeDone=1&take=1000", {
    cache: "no-store",
  });

  if (!res.ok) throw new Error("ORDER_LOAD_FAILED");

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

async function saveOrderPatch(order: StoredOrder, patch: Record<string, any>) {
  const next = {
    ...order,
    ...patch,
    meta: {
      ...(order as any).meta,
      ...(patch.meta || {}),
    },
  };

  const importRes = await fetch("/api/admin/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "import",
      orders: [next],
    }),
  }).catch(() => null);

  return Boolean(importRes?.ok);
}

async function writeStatus(id: string, status: OrderStatus, driver?: string) {
  const res = await fetch("/api/orders/status", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id,
      status,
      by: driver ? `driver:${driver}` : "scan",
      driver: driver || undefined,
    }),
  }).catch(() => null);

  if (res?.ok) return true;

  const fallback = await fetch("/api/admin/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "setStatus",
      id,
      status,
      by: driver ? `driver:${driver}` : "scan",
      note: driver ? `Fahrer: ${driver}` : undefined,
    }),
  }).catch(() => null);

  return Boolean(fallback?.ok);
}

export default function ScanPage() {
  const searchParams = useSearchParams();
  const id = useMemo(() => String(searchParams.get("id") ?? "").trim(), [searchParams]);

  const [pin, setPin] = useState("");
  const [ok, setOk] = useState(false);
  const [driver, setDriver] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [order, setOrder] = useState<StoredOrder | null>(null);
  const [loading, setLoading] = useState(false);

  const loadOrder = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const found = await fetchOrder(id);
      setOrder(found);
    } catch (error) {
      console.error("[scan] order load failed:", error);
      setOrder(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadOrder();
  }, [loadOrder]);

  // Google Maps URL (adres varsa)
  const mapsURL = useMemo(() => {
    const addr = String(order?.customer?.address || "").trim();
    if (!addr) return "";
    const q = encodeURIComponent(addr);
    return `https://www.google.com/maps/search/?api=1&query=${q}`;
  }, [order]);

  useEffect(() => {
    const last = localStorage.getItem("bb_last_driver") || "";
    if (last) setDriver(last);
  }, []);

  if (!id) {
    return (
      <Wrap>
        <h1>Scan</h1>
        <p>Ungültiger Link: ID-Parameter fehlt.</p>
      </Wrap>
    );
  }

  if (loading) {
    return (
      <Wrap>
        <h1>Scan</h1>
        <p>Bestellung wird geladen...</p>
      </Wrap>
    );
  }

  if (!order) {
    return (
      <Wrap>
        <h1>Scan</h1>
        <p>Bestellung nicht gefunden: <b>{id}</b></p>
      </Wrap>
    );
  }

  if (!ok) {
    return (
      <Wrap>
        <h1>Fahrer-Panel</h1>
        <p>Bestell-ID: <b>#{id}</b></p>
        <p>Bitte PIN eingeben.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (pin === PIN) setOk(true);
            else {
              setMsg("Falsche PIN.");
              setTimeout(() => setMsg(null), 2000);
            }
          }}
        >
          <input
            type="password"
            placeholder="PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            autoFocus
            style={inputStyle}
          />
          <button type="submit" style={btnStyle}>Bestätigen</button>
        </form>
        {msg && <p style={{ color: "#f33", marginTop: 8 }}>{msg}</p>}
      </Wrap>
    );
  }

  const driverName = (order as any)?.driverName || (order as any)?.driver || "";
  const isDelivery = order.mode === "delivery";

  const setUnterwegs = async () => {
    if (!driver.trim()) {
      setMsg("Fahrername erforderlich.");
      setTimeout(() => setMsg(null), 2000);
      return;
    }

    const name = driver.trim();
    const nextStatus: OrderStatus = "out_for_delivery";

    const saved = await saveOrderPatch(order, {
      driverName: name,
      driver: name,
      driverAt: Date.now(),
      meta: {
        ...(order as any).meta,
        driverName: name,
        driverAt: Date.now(),
      },
    });

    const statusSaved = await writeStatus(order.id, nextStatus, name);

    if (!saved && !statusSaved) {
      setMsg("Aktualisierung fehlgeschlagen.");
      setTimeout(() => setMsg(null), 2000);
      return;
    }

    localStorage.setItem("bb_last_driver", name);
    setOrder({ ...(order as any), driverName: name, driver: name, status: nextStatus });
    setMsg("Als „Unterwegs“ gesetzt.");
    setTimeout(() => setMsg(null), 1500);
    void loadOrder();
  };

  const setFertig = async () => {
    const saved = await writeStatus(order.id, "done", driver.trim());

    if (!saved) {
      setMsg("Aktualisierung fehlgeschlagen.");
      setTimeout(() => setMsg(null), 2000);
      return;
    }

    setOrder({ ...(order as any), status: "done" });
    setMsg("Als „Fertig“ gesetzt.");
    setTimeout(() => setMsg(null), 1500);
    void loadOrder();
  };

  const clearDriver = async () => {
    const saved = await saveOrderPatch(order, {
      driverName: "",
      driver: "",
      meta: {
        ...(order as any).meta,
        driverName: "",
      },
    });

    if (!saved) {
      setMsg("Aktualisierung fehlgeschlagen.");
      setTimeout(() => setMsg(null), 2000);
      return;
    }

    setOrder({ ...(order as any), driverName: "", driver: "" });
    setMsg("Fahrer entfernt.");
    setTimeout(() => setMsg(null), 1500);
    void loadOrder();
  };

  return (
    <Wrap>
      <h1>Fahrer-Panel</h1>

      <Card>
        <Row><Label>Bestell-ID</Label><Val>#{order.id}</Val></Row>
        <Row><Label>Modus</Label><Val>{order.mode === "delivery" ? "Lieferung" : "Abholung"}</Val></Row>
        <Row><Label>Kunde</Label><Val>{order.customer?.name || "-"}</Val></Row>
        <Row><Label>Telefon</Label><Val>{order.customer?.phone || "-"}</Val></Row>
        <Row><Label>Adresse</Label><Val>{order.customer?.address || "-"}</Val></Row>
        <Row><Label>Status</Label><Val>{order.status || "-"}</Val></Row>
        <Row><Label>Fahrer</Label><Val>{driverName || "-"}</Val></Row>
      </Card>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        {mapsURL ? (
          <a href={mapsURL} target="_blank" rel="noreferrer" style={btnStyle}>Google Maps</a>
        ) : null}

        {isDelivery && (
          <>
            <input
              type="text"
              placeholder="Fahrername"
              value={driver}
              onChange={(e) => setDriver(e.target.value)}
              style={{ ...inputStyle, minWidth: 160 }}
            />
            <button onClick={setUnterwegs} style={btnStyle}>Unterwegs setzen</button>
          </>
        )}

        <button onClick={setFertig} style={btnStyle}>Fertig setzen</button>

        {(driverName || "").trim() ? (
          <button onClick={clearDriver} style={{ ...btnStyle, background: "#444" }}>Fahrer entfernen</button>
        ) : null}
      </div>

      {msg && <p style={{ marginTop: 8, color: "#0ea5e9" }}>{msg}</p>}
    </Wrap>
  );
}

/* ── mini UI ── */
function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 680, margin: "24px auto", padding: 16, fontFamily: "ui-sans-serif, system-ui, Arial" }}>
      {children}
    </div>
  );
}
function Card({ children }: { children: React.ReactNode }) {
  return <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12, background: "#fafafa" }}>{children}</div>;
}
function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "baseline" }}>{children}</div>;
}
function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ width: 110, color: "#6b7280", fontSize: 13 }}>{children}</div>;
}
function Val({ children }: { children: React.ReactNode }) {
  return <div style={{ fontWeight: 600 }}>{children}</div>;
}
const inputStyle: React.CSSProperties = { border: "1px solid #d1d5db", borderRadius: 6, padding: "8px 10px" };
const btnStyle: React.CSSProperties = { background: "#111827", color: "#fff", border: "1px solid #111", borderRadius: 6, padding: "8px 12px", cursor: "pointer" };