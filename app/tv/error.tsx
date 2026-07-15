"use client";

import { useEffect } from "react";

export default function OperationalRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("OPERATIONAL_ROUTE_ERROR", error);
  }, [error]);

  return (
    <main
      style={{
        minHeight: "100svh",
        padding: 20,
        background: "#020617",
        color: "#f8fafc",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      }}
    >
      <h1 style={{ color: "#f87171" }}>ROUTE HATASI</h1>
      <p>Bu ekranın fotoğrafını gönder.</p>
      <pre
        style={{
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          padding: 12,
          borderRadius: 12,
          background: "#1f0a0a",
          border: "1px solid #7f1d1d",
        }}
      >
        {`${error?.message || "Bilinmeyen hata"}\n\n${error?.stack || ""}\n\nDigest: ${error?.digest || "-"}`}
      </pre>
      <button
        type="button"
        onClick={reset}
        style={{
          minHeight: 46,
          padding: "0 18px",
          borderRadius: 12,
          border: 0,
          background: "#0284c7",
          color: "#fff",
          fontWeight: 800,
        }}
      >
        TEKRAR DENE
      </button>
    </main>
  );
}
