"use client";

import { useEffect, useRef, type MouseEvent } from "react";
import clsx from "clsx";
import type { TvConfirmRequest } from "@/types/tv";

export function TvConfirmDialog({
  request,
  busy = false,
  onConfirm,
  onCancel,
}: {
  request: TvConfirmRequest | null;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!request) return;

    confirmRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel, request]);

  if (!request) return null;

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tv-confirm-title"
      onMouseDown={(event: MouseEvent<HTMLDivElement>) => {
        if (event.currentTarget === event.target && !busy) onCancel();
      }}
    >
      <div className="w-full max-w-lg rounded-3xl border border-white/15 bg-stone-950/95 p-6 shadow-2xl">
        <h2 id="tv-confirm-title" className="text-2xl font-black text-white">
          {request.title}
        </h2>

        <p className="mt-3 whitespace-pre-wrap text-base leading-relaxed text-stone-300">
          {request.message}
        </p>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 font-bold text-stone-200 hover:bg-white/10 disabled:cursor-wait disabled:opacity-50"
          >
            {request.cancelLabel || "Nein"}
          </button>

          <button
            ref={confirmRef}
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={clsx(
              "rounded-2xl border px-4 py-3 font-black text-white disabled:cursor-wait disabled:opacity-60",
              request.danger
                ? "border-rose-300/60 bg-rose-600 hover:bg-rose-500"
                : "border-emerald-300/60 bg-emerald-600 hover:bg-emerald-500",
            )}
          >
            {busy ? "Bitte warten …" : request.confirmLabel || "Ja"}
          </button>
        </div>
      </div>
    </div>
  );
}
