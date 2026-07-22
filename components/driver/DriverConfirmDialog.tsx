"use client";

import type { DriverConfirmRequest } from "@/types/driver";

export function DriverConfirmDialog({
  request,
  busy,
  onConfirm,
  onCancel,
}: {
  request: DriverConfirmRequest | null;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!request) return null;

  const danger = request.tone === "danger";
  const warning = request.tone === "warning";

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-lg rounded-[1.75rem] border border-white/15 bg-stone-950 p-5 text-stone-100 shadow-2xl">
        <h2 className="text-xl font-black">{request.title}</h2>
        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-stone-300">
          {request.message}
        </p>

        {request.details?.length ? (
          <div className="mt-4 max-h-52 space-y-2 overflow-y-auto rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm text-stone-200">
            {request.details.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        ) : null}

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-2xl border border-white/15 bg-white/[0.05] px-4 py-3 font-extrabold text-stone-200 transition active:scale-[0.98] disabled:opacity-50"
          >
            {request.cancelLabel || "Abbrechen"}
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`rounded-2xl px-4 py-3 font-black transition active:scale-[0.98] disabled:opacity-50 ${
              danger
                ? "bg-rose-500 text-white"
                : warning
                  ? "bg-amber-400 text-black"
                  : "bg-emerald-400 text-black"
            }`}
          >
            {busy ? "Bitte warten…" : request.confirmLabel || "Bestätigen"}
          </button>
        </div>
      </div>
    </div>
  );
}
