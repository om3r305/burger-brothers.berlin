// app/driver/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  readAllOrders,
  setOrderStatus,
  upsertOrder,
  StoredOrder,
} from "@/lib/orders";

const DRIVER_PASSWORD = "1905";

function buildMapsQuery(addr: string) {
  const query = encodeURIComponent(addr);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

export default function DriverPage({ params }: { params: { id: string } }) {
  const orderId = decodeURIComponent(params.id);

  const [mounted, setMounted] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [pw, setPw] = useState("");
  const [driverName, setDriverName] = useState("");

  useEffect(() => setMounted(true), []);

  const order: StoredOrder | undefined = useMemo(() => {
    const all = readAllOrders() || [];
    return all.find((o: any) => String(o.id) === String(orderId));
  }, [orderId]);

  if (!mounted) {
    return (
      <main style={styles.wrap}>
        <div style={styles.box}>Yükleniyor…</div>
      </main>
    );
  }
  if (!order) {
    return (
      <main style={styles.wrap}>
        <div style={styles.box}>
          <div style={styles.title}>Sipariş bulunamadı</div>
          <div style={{ opacity: 0.8, marginTop: 8 }}>
            ID: <b>{orderId}</b>
          </div>
        </div>
      </main>
    );
  }

  const isDelivery = order.mode === "delivery";
  const address = (order.customer?.address || "").trim();
  const mapsURL = address ? buildMapsQuery(address) : undefined;

  const handleAuth = (e: React.FormEvent) => {
    e.preventDefault();
    if (pw === DRIVER_PASSWORD) {
      setAuthed(true);
    } else {
      alert("Şifre hatalı.");
    }
  };

  const goUnterwegs = () => {
    if (!isDelivery) return;
    // Şoför adını siparişe yazıyoruz
    upsertOrder({ ...order, driverName: driverName.trim() });
    setOrderStatus(order.id, "out_for_delivery");
    alert("Durum güncellendi: Unterwegs");
  };

  const goDone = () => {
    // Tamamlandı yap
    setOrderStatus(order.id, "done");
    alert("Durum güncellendi: Abgeschlossen");
  };

  return (
    <main style={styles.wrap}>
      <div style={styles.box}>
        <div style={styles.brand}>Burger Brothers</div>

        {!authed ? (
          <>
            <div style={styles.title}>Giriş</div>
            <form onSubmit={handleAuth} style={{ marginTop: 10 }}>
              <div style={styles.formRow}>
                <label style={styles.label}>Şifre</label>
                <input
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  type="password"
                  inputMode="numeric"
                  placeholder="1905"
                  style={styles.input}
                  autoFocus
                />
              </div>
              <div style={styles.formRow}>
                <label style={styles.label}>Şoför adı</label>
                <input
                  value={driverName}
                  onChange={(e) => setDriverName(e.target.value)}
                  type="text"
                  placeholder="Örn. Farah"
                  style={styles.input}
                />
              </div>
              <button type="submit" style={styles.primary}>
                Devam et
              </button>
            </form>
          </>
        ) : (
          <>
            <div style={styles.title}>
              {isDelivery ? "Lieferung" : "Abholung"}
            </div>

            <div style={styles.meta}>
              <div>
                <span style={styles.k}>Bestell-ID:</span> <b>#{order.id}</b>
              </div>
              {order.customer?.name && (
                <div>
                  <span style={styles.k}>Kunde:</span>{" "}
                  <b>{order.customer.name}</b>
                </div>
              )}
              {order.customer?.phone && (
                <div>
                  <span style={styles.k}>Tel:</span>{" "}
                  <a href={`tel:${order.customer.phone}`} style={styles.link}>
                    {order.customer.phone}
                  </a>
                </div>
              )}
              {isDelivery && address && (
                <div>
                  <span style={styles.k}>Adressese:</span> <b>{address}</b>
                </div>
              )}
              {driverName.trim() && (
                <div>
                  <span style={styles.k}>Fahrer:</span>{" "}
                  <b>{driverName.trim()}</b>
                </div>
              )}
            </div>

            {isDelivery && mapsURL && (
              <a
                href={mapsURL}
                target="_blank"
                rel="noreferrer"
                style={styles.primary}
              >
                Google Maps’i Aç
              </a>
            )}

            <div style={{ height: 8 }} />

            {isDelivery ? (
              <div style={styles.btnRow}>
                <button onClick={goUnterwegs} style={styles.secondary}>
                  Unterwegs setzen
                </button>
                <button onClick={goDone} style={styles.success}>
                  Abgeschlossen
                </button>
              </div>
            ) : (
              <div style={styles.btnRow}>
                <button onClick={goDone} style={styles.success}>
                  Abgeschlossen
                </button>
              </div>
            )}

            <div style={styles.tip}>
              QR → şifre (1905) → şoför adını yaz → durumu güncelle.
            </div>
          </>
        )}
      </div>

      <style>{`
        html, body { background:#0b0f14; color:#e5e7eb; }
      `}</style>
    </main>
  );
}

/* ——— Styles ——— */
const styles: Record<string, React.CSSProperties> = {
  wrap: {
    minHeight: "100dvh",
    padding: 16,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background:
      "radial-gradient(1000px 600px at 10% -10%, rgba(59,130,246,.15), transparent), radial-gradient(800px 500px at 90% 0%, rgba(16,185,129,.12), transparent), linear-gradient(180deg,#0b0f14,#0f1318)",
  },
  box: {
    width: "100%",
    maxWidth: 520,
    borderRadius: 16,
    padding: 18,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.15)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,.2)",
  },
  brand: { fontSize: 20, fontWeight: 800, letterSpacing: 0.2, marginBottom: 6 },
  title: { fontSize: 22, fontWeight: 800, marginTop: 2 },
  meta: { marginTop: 8, lineHeight: 1.5 },
  k: { opacity: 0.8, marginRight: 6 },
  link: { color: "#93c5fd", textDecoration: "none" },
  btnRow: { display: "flex", gap: 10, marginTop: 12 },
  primary: {
    display: "block",
    width: "100%",
    textAlign: "center",
    marginTop: 12,
    padding: "12px 14px",
    fontWeight: 800,
    borderRadius: 12,
    background: "#1f2937",
    border: "1px solid rgba(255,255,255,.15)",
    color: "#e5e7eb",
  },
  secondary: {
    flex: 1,
    padding: "12px 14px",
    fontWeight: 800,
    borderRadius: 12,
    background: "rgba(37,99,235,.16)",
    border: "1px solid rgba(96,165,250,.5)",
    color: "#dbeafe",
  },
  success: {
    flex: 1,
    padding: "12px 14px",
    fontWeight: 800,
    borderRadius: 12,
    background: "rgba(16,185,129,.18)",
    border: "1px solid rgba(110,231,183,.55)",
    color: "#d1fae5",
  },
  tip: { marginTop: 12, fontSize: 12, opacity: 0.85 },
  formRow: { display: "grid", gap: 6, marginTop: 8 },
  label: { fontSize: 13, opacity: 0.9 },
  input: {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,.18)",
    background: "rgba(0,0,0,.2)",
    color: "#e5e7eb",
    outline: "none",
  },
};
