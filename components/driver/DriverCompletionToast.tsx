"use client";

import type { DriverCompletionToast } from "@/types/driver";

export function DriverCompletionToast({
  value,
}: {
  value: DriverCompletionToast | null;
}) {
  if (!value) return null;

  return (
    <div className="fixed left-3 right-3 top-[max(1rem,env(safe-area-inset-top))] z-50 mx-auto max-w-md rounded-2xl border border-emerald-300/45 bg-emerald-500/95 px-4 py-3 text-sm text-black shadow-2xl">
      <div className="font-extrabold">Lieferung abgeschlossen ✅</div>
      <div className="mt-0.5">
        #{value.id} · Trinkgeld: <b>{value.tip.toFixed(2)}€</b>
        {value.total > 0 ? (
          <>
            <span className="mx-1">·</span>
            Gesamt: <b>{value.total.toFixed(2)}€</b>
          </>
        ) : null}
      </div>
    </div>
  );
}
