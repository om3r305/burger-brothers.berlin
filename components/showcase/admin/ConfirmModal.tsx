"use client";

import { useEffect } from "react";

export type ShowcaseConfirmState = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm?: () => void | Promise<void>;
};

export const EMPTY_CONFIRM_STATE: ShowcaseConfirmState = {
  open: false,
  title: "",
  message: "",
};

export default function ConfirmModal({
  state,
  busy = false,
  onClose,
}: {
  state: ShowcaseConfirmState;
  busy?: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!state.open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose, state.open]);

  if (!state.open) return null;

  return (
    <div className="fixed inset-0 z-[2000] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="showcase-confirm-title">
      <div className="w-full max-w-md rounded-3xl border border-stone-700 bg-stone-950 p-6 shadow-2xl">
        <h2 id="showcase-confirm-title" className="text-xl font-black text-white">{state.title}</h2>
        <p className="mt-3 text-sm leading-relaxed text-stone-300">{state.message}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" disabled={busy} onClick={onClose} className="rounded-xl border border-stone-700 px-4 py-2.5 text-sm font-bold text-stone-200 hover:bg-stone-800 disabled:opacity-50">Vazgeç</button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void state.onConfirm?.()}
            className={state.danger
              ? "rounded-xl bg-red-600 px-4 py-2.5 text-sm font-black text-white hover:bg-red-500 disabled:opacity-50"
              : "rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-black text-black hover:bg-orange-400 disabled:opacity-50"}
          >
            {busy ? "İşleniyor…" : state.confirmLabel || "Onayla"}
          </button>
        </div>
      </div>
    </div>
  );
}
