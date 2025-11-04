// components/ui/DateTimePicker.tsx
"use client";

import { useEffect, useId, useRef, useState } from "react";

type Props = {
  value?: string; // ISO: "2025-03-20T18:00"
  onChange: (isoOrEmpty: string) => void;
  placeholder?: string;
  label?: string;
  min?: string; // ISO
  max?: string; // ISO
};

function isoToParts(iso?: string) {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: "", time: "" };
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}
function partsToIso(date: string, time: string) {
  if (!date) return "";
  const t = time || "00:00";
  return `${date}T${t}`;
}

export default function DateTimePicker({ value, onChange, placeholder = "Tarih & Saat", label, min, max }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  const parts = isoToParts(value);
  const [date, setDate] = useState(parts.date);
  const [time, setTime] = useState(parts.time);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popRef.current || !btnRef.current) return;
      if (!popRef.current.contains(t) && !btnRef.current.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    const p = isoToParts(value);
    setDate(p.date);
    setTime(p.time);
  }, [value]);

  const apply = () => {
    const iso = partsToIso(date, time);
    onChange(iso);
    setOpen(false);
  };
  const clear = () => {
    setDate("");
    setTime("");
    onChange("");
    setOpen(false);
  };

  const display =
    value && !isNaN(new Date(value).getTime())
      ? new Date(value).toLocaleString()
      : placeholder;

  return (
    <div className="relative inline-block">
      {label ? (
        <label className="mb-1 block text-sm text-stone-300/80" htmlFor={id}>
          {label}
        </label>
      ) : null}
      <button
        id={id}
        ref={btnRef}
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 text-left outline-none hover:bg-stone-900/60 focus:ring-2 focus:ring-amber-500/40"
      >
        {display}
      </button>

      {open && (
        <div
          ref={popRef}
          className="absolute z-50 mt-2 w-72 rounded-xl border border-stone-700/60 bg-stone-900/95 p-3 shadow-xl"
        >
          <div className="grid grid-cols-1 gap-3">
            <div>
              <div className="mb-1 text-xs text-stone-300/80">Tarih</div>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                min={min ? isoToParts(min).date : undefined}
                max={max ? isoToParts(max).date : undefined}
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
              />
            </div>
            <div>
              <div className="mb-1 text-xs text-stone-300/80">Saat</div>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
              />
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <button className="btn-ghost" onClick={clear}>Temizle</button>
            <button className="card-cta" onClick={apply}>Uygula</button>
          </div>
        </div>
      )}
    </div>
  );
}
