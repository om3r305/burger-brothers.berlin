"use client";

import { iconBtn } from "@/lib/tv/domain";

export function TvHeader({
  nowMs,
  onMenu,
  onLogout,
}: {
  nowMs: number;
  onMenu: () => void;
  onLogout: () => void | Promise<void>;
}) {
  return (
    <header className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <button
          className={`${iconBtn} mr-1`}
          onClick={onMenu}
          title="Menü"
        >
          ☰
        </button>

        <div className="flex items-center gap-2">
          <img
            src="/logo-burger-brothers.png"
            className="h-14 w-14"
            alt="Logo"
          />
          <div className="text-2xl font-bold">Burger Brothers</div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span suppressHydrationWarning className="opacity-80">
          {new Date(nowMs).toLocaleString("de-DE")}
        </span>

        <button
          onClick={onLogout}
          title="Abmelden"
          className={iconBtn}
        >
          ⏻ Abmelden
        </button>
      </div>
    </header>
  );
}
