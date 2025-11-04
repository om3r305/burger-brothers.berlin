// app/scan/page.tsx
"use client";

import { useMemo, useState, useEffect } from "react";
import { readAllOrders, setOrderStatus, upsertOrder, StoredOrder } from "@/lib/orders";

const PIN = "1905";

export default function ScanPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const id = useMemo(() => String(searchParams?.id ?? "").trim(), [searchParams?.id]);
  const [pin, setPin] = useState("");
  const [ok, setOk] = useState(false);
  const [driver, setDriver] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const order = useMemo<StoredOrder | null>(() => {
    const all = readAllOrders() || [];
    const o = all.find((x: any) => String(x.id) === id);
    return (o as any) || null;
  }, [id]);

  // Google Maps URL (adres varsa)
  const mapsURL = useMemo(() => {
    const addr = String(order?.customer?.address || "").trim();
    if (!addr) return "";
    const q = encodeURIComponent(addr);
    return `https://www.google.com/maps/search/?api=1&query=${q}`;
  }, [order]);

  useEffect(() => {
    // Yerel depodan son sürülen şoför ismini öner
    const last = localStorage.getItem("bb_last_driver") || "";
    if (last) setDriver(last);
  }, []);

  if (!id) {
    return (
      <Wrap>
        <h1>Scan</h1>
        <p>Ungültig bağlantı: id parametresi yok.</p>
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
            else { setMsg("Falsche PIN."); setTimeout(() => setMsg(null), 2000); }
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

  const driverName = (order as any)?.driverName || "";
  const isDelivery = order.mode === "delivery";

  const setUnterwegs = () => {
    if (!driver.trim()) { setMsg("Fahrername erforderlich."); setTimeout(() => setMsg(null), 2000); return; }
    upsertOrder({ ...(order as any), driverName: driver.trim(), driverAt: Date.now() });
    setOrderStatus(order.id, "out_for_delivery");
    localStorage.setItem("bb_last_driver", driver.trim());
    setMsg("Als 'Unterwegs' gesetzt.");
    setTimeout(() => setMsg(null), 1500);
  };

  const setFertig = () => {
    setOrderStatus(order.id, "done");
    setMsg("Als 'Fertig' gesetzt.");
    setTimeout(() => setMsg(null), 1500);
  };

  const clearDriver = () => {
    upsertOrder({ ...(order as any), driverName: "" });
    setMsg("Fahrer entfernt.");
    setTimeout(() => setMsg(null), 1500);
  };

  return (
    <Wrap>
      <h1>Fahrer-Panel</h1>

      <Card>
        <Row><Label>Bestell-ID</Label><Val>#{order.id}</Val></Row>
        <Row><Label>Modus</Label><Val>{order.mode === "delivery" ? "Lieferung" : "Abholung"}</Val></Row>
        <Row><Label>Kunde</Label><Val>{order.customer?.name || "-"}</Val></Row>
        <Row><Label>Telefon</Label><Val>{order.customer?.phone || "-"}</Val></Row>
        <Row><Label>Adressese</Label><Val>{order.customer?.address || "-"}</Val></Row>
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
