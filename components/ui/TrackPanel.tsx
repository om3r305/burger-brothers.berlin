// components/ui/TrackPanel.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function TrackPanel({
  variant = "default",
}: { variant?: "default" | "emphasized" }) {
  const router = useRouter();
  const [val, setVal] = useState("");

  const go = () => {
    const code = (val || "").trim();
    if (!code) return;

    // boşlukları at ve büyük harfe çevir → /track/ID'ye yönlendir
    const clean = code.replace(/\s+/g, "").toUpperCase();
    router.push(`/track/${clean}`);
  };

  return (
    <div
      className={
        variant === "emphasized"
          ? "rounded-2xl border border-stone-700/60 bg-stone-900/60 p-4"
          : "rounded-md border border-stone-700/60 p-3"
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
        className="flex items-center gap-2"
      >
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="Bestellnummer eingeben (z. B. WUZV2M)"
          className="flex-1 rounded-md px-3 py-2 bg-stone-800/60 outline-none"
        />
        <button
          type="submit"
          className="rounded-md px-4 py-2 font-semibold bg-amber-500 text-black hover:bg-amber-400"
        >
          Anzeigen
        </button>
      </form>
    </div>
  );
}
