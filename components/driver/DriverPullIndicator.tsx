"use client";

export function DriverPullIndicator({
  distance,
  visible,
  ready,
  refreshing,
}: {
  distance: number;
  visible: boolean;
  ready: boolean;
  refreshing: boolean;
}) {
  const position = Math.max(0, Math.min(24, distance / 4));

  return (
    <div
      className={`fixed left-1/2 top-[max(.75rem,env(safe-area-inset-top))] z-50 -translate-x-1/2 rounded-full border px-4 py-2 text-xs font-semibold shadow-xl transition-all ${
        visible ? "translate-y-0 opacity-100" : "-translate-y-6 opacity-0"
      } ${
        refreshing || ready
          ? "border-emerald-300/50 bg-emerald-500/90 text-black"
          : "border-white/15 bg-stone-900/90 text-stone-100"
      }`}
      style={{ transform: `translate(-50%, ${position}px)` }}
    >
      {refreshing
        ? "Aktualisiere…"
        : ready
          ? "Loslassen zum Aktualisieren"
          : "Zum Aktualisieren nach unten ziehen"}
    </div>
  );
}
