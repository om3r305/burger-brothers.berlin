"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * /print/barcode
 * - ID ile yazdır (proxy /print/pdf, URL: https://site/print/barcode/{ID})
 * - JSON order ile yazdır (proxy /print/full)
 *
 * Gerekli .env:
 *   NEXT_PUBLIC_PRINT_PROXY_URL=http://192.168.0.50:7777
 */

const PROXY = process.env.NEXT_PUBLIC_PRINT_PROXY_URL || "";

function classNames(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(" ");
}

export default function PrintBarcodePage() {
  const [orderId, setOrderId] = useState("");
  const [json, setJson] = useState("{\n  \"id\": \"ORD-20251102-001\",\n  \"ts\": " + Date.now() + ",\n  \"mode\": \"delivery\",\n  \"customer\": {\"name\":\"Musteri Adı\",\"zip\":\"13507\",\"street\":\"Berliner Str.\",\"houseNo\":\"9\"},\n  \"items\": [\n    {\"name\":\"Classic Burger\",\"qty\":1,\"price\":8.9,\"taxRate\":7},\n    {\"name\":\"Cola 0,33L\",\"qty\":1,\"price\":2.5,\"taxRate\":19}\n  ],\n  \"pricing\": {\"subtotal\":11.4,\"delivery\":2.5,\"discount\":0,\"total\":13.9}\n}\n");
  const [busy, setBusy] = useState<"id" | "json" | null>(null);
  const [msg, setMsg] = useState<string>("");

  // Origin’i güvenli üret (SSR yok, client)
  const origin = useMemo(() => {
    try {
      return window.location.origin;
    } catch {
      return "";
    }
  }, []);

  const canUseProxy = !!PROXY;

  async function postJson(path: string, body: any) {
    const url = `${PROXY}${path}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} – ${t || "Fehler"}`);
    }
    return res.json().catch(() => ({}));
  }

  // 1) ID ile yazdır: proxy /print/pdf —> resolveOrderFromUrl('/print/barcode/{id}') —> /api/orders
  async function handlePrintById() {
    setMsg("");
    if (!canUseProxy) {
      setMsg("Proxy-URL fehlt: NEXT_PUBLIC_PRINT_PROXY_URL .env’de ayarlanmalı.");
      return;
    }
    if (!orderId.trim()) {
      setMsg("Bestell-ID giriniz.");
      return;
    }
    setBusy("id");
    try {
      // Proxy, bu URL’den ID’yi çözüp aynı hostta /api/orders çağırır:
      const urlForProxy = `${origin}/print/barcode/${encodeURIComponent(orderId.trim())}`;
      const out = await postJson("/print/pdf", { url: urlForProxy, options: { brand: "Burger Brothers" } });
      setMsg(out?.ok ? `OK – gedruckt: ${out?.printed || orderId}` : "Druck fehlgeschlagen.");
    } catch (e: any) {
      setMsg(e?.message || "Fehler");
    } finally {
      setBusy(null);
    }
  }

  // 2) JSON order ile yazdır: /print/full
  async function handlePrintByJson() {
    setMsg("");
    if (!canUseProxy) {
      setMsg("Proxy-URL fehlt: NEXT_PUBLIC_PRINT_PROXY_URL .env’de ayarlanmalı.");
      return;
    }
    let payload: any;
    try {
      payload = JSON.parse(json);
    } catch {
      setMsg("Geçersiz JSON.");
      return;
    }
    setBusy("json");
    try {
      const out = await postJson("/print/full", { order: payload, options: { brand: "Burger Brothers" } });
      setMsg(out?.ok ? `OK – gedruckt: ${out?.printed || payload?.id || ""}` : "Druck fehlgeschlagen.");
    } catch (e: any) {
      setMsg(e?.message || "Fehler");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "radial-gradient(1000px 600px at 50% -10%, #1b1b1b 0%, #0a0a0a 60%, #000 100%)",
        color: "#eee",
        display: "grid",
        placeItems: "center",
        padding: "24px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 720,
          background: "rgba(20,20,20,0.6)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 16,
          padding: 20,
          backdropFilter: "blur(16px)",
          boxShadow: "0 10px 40px rgba(0,0,0,0.45)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <img
            src="/logo-burger-brothers.png"
            alt="Burger Brothers Berlin"
            style={{ width: 56, height: 56, objectFit: "contain", filter: "drop-shadow(0 2px 10px rgba(0,0,0,0.6))" }}
          />
          <div style={{ lineHeight: 1.15 }}>
            <div style={{ fontSize: 20, fontWeight: 700 }}>Barcode / Bon Drucken</div>
            <div style={{ fontSize: 13, opacity: 0.8 }}>
              Proxy: {canUseProxy ? <code>{PROXY}</code> : <span style={{ color: "#ffb3a7" }}>— fehlt —</span>}
            </div>
          </div>
        </div>

        {/* MODE 1: ID ile yazdır */}
        <div
          style={{
            marginTop: 16,
            padding: 14,
            border: "1px dashed rgba(255,255,255,0.12)",
            borderRadius: 12,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 8 }}>1) Nur mit Bestell-ID</div>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr auto" }}>
            <input
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              placeholder="ORD-YYYYMMDD-###"
              style={{
                width: "100%",
                padding: "12px 12px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.14)",
                background: "rgba(0,0,0,0.35)",
                color: "#fff",
                outline: "none",
              }}
            />
            <button
              onClick={handlePrintById}
              disabled={busy === "id"}
              style={{
                minWidth: 150,
                padding: "12px 14px",
                borderRadius: 10,
                border: "none",
                cursor: "pointer",
                background: busy === "id" ? "#555" : "#ff6a00",
                color: "#fff",
                fontWeight: 600,
              }}
            >
              {busy === "id" ? "Druckt…" : "Mit ID drucken"}
            </button>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
            Proxy, <code>/print/pdf</code> çağrısında <code>{origin}/print/barcode/&lt;ID&gt;</code> URL’sinden ID’yi çözer ve
            aynı hostta <code>/api/orders</code> arayıp siparişi bulur.
          </div>
        </div>

        {/* MODE 2: JSON ile yazdır */}
        <div
          style={{
            marginTop: 16,
            padding: 14,
            border: "1px dashed rgba(255,255,255,0.12)",
            borderRadius: 12,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 8 }}>2) Mit JSON (voller Bon)</div>
          <textarea
            value={json}
            onChange={(e) => setJson(e.target.value)}
            rows={10}
            style={{
              width: "100%",
              padding: 12,
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(0,0,0,0.35)",
              color: "#fff",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            }}
          />
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <button
              onClick={handlePrintByJson}
              disabled={busy === "json"}
              style={{
                padding: "12px 14px",
                borderRadius: 10,
                border: "none",
                cursor: "pointer",
                background: busy === "json" ? "#555" : "#22b575",
                color: "#fff",
                fontWeight: 700,
              }}
            >
              {busy === "json" ? "Druckt…" : "Mit JSON drucken"}
            </button>
            <button
              onClick={() =>
                setJson((j) => {
                  try {
                    const o = JSON.parse(j);
                    o.id = o.id || `ORD-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-001`;
                    o.ts = Date.now();
                    return JSON.stringify(o, null, 2);
                  } catch {
                    return j;
                  }
                })
              }
              style={{
                padding: "12px 14px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.18)",
                background: "transparent",
                color: "#fff",
                fontWeight: 600,
              }}
            >
              ID/Tarih Güncelle
            </button>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
            Bu seçenek doğrudan <code>/print/full</code>’e gönderir (senin tasarımın aynen basılır).
          </div>
        </div>

        {/* Sonuç */}
        {!!msg && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              borderRadius: 10,
              background: "rgba(0,0,0,0.45)",
              border: "1px solid rgba(255,255,255,0.12)",
              fontSize: 14,
              whiteSpace: "pre-wrap",
            }}
          >
            {msg}
          </div>
        )}

        {/* Küçük ipuçları */}
        <div style={{ marginTop: 14, fontSize: 12, opacity: 0.8, lineHeight: 1.5 }}>
          <div>• Proxy cihazında port <code>7777</code> LAN’dan erişilebilir olmalı.</div>
          <div>
            • Proxy’yi başlatırken <code>ALLOW_ORIGINS={origin}</code> vermeyi unutma (CORS).
          </div>
          <div>• Yazıcı IP/port: <code>PRINTER_IP</code> / <code>PRINTER_PORT</code>.</div>
        </div>
      </div>
    </div>
  );
}