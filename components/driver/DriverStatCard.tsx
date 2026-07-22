"use client";

import type { ReactNode } from "react";

export function DriverStatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: string;
  label: string;
  value: ReactNode;
  tone: "blue" | "gold" | "green";
}) {
  const toneClass = {
    blue: {
      card: "border-sky-300/15 bg-sky-500/10",
      icon: "border-sky-300/25 bg-sky-400/15 text-sky-200 shadow-[0_0_16px_rgba(56,189,248,.10)]",
      label: "text-sky-100/70",
    },
    gold: {
      card: "border-amber-300/15 bg-amber-400/10",
      icon: "border-amber-300/25 bg-amber-400/15 text-amber-200 shadow-[0_0_16px_rgba(251,191,36,.10)]",
      label: "text-amber-100/70",
    },
    green: {
      card: "border-emerald-300/15 bg-emerald-400/10",
      icon: "border-emerald-300/25 bg-emerald-400/15 text-emerald-200 shadow-[0_0_16px_rgba(52,211,153,.10)]",
      label: "text-emerald-100/70",
    },
  }[tone];

  return (
    <div className={`rounded-xl border px-2.5 py-2 ${toneClass.card}`}>
      <div className="flex items-center gap-2.5">
        <div
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border text-lg ${toneClass.icon}`}
          aria-hidden="true"
        >
          {icon}
        </div>

        <div className="min-w-0">
          <div className={`text-[10px] font-bold uppercase tracking-wide ${toneClass.label}`}>
            {label}
          </div>
          <div className="mt-0.5 truncate text-sm font-extrabold text-stone-50 sm:text-base">
            {value}
          </div>
        </div>
      </div>
    </div>
  );
}
