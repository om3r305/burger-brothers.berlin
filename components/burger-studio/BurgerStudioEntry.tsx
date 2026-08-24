"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { startAppNavigation } from "@/components/AppRouteTransition";
import {
  fetchAndApplyRemoteSettings,
  readSettings,
} from "@/lib/settings";

const CUSTOMER_MENU_PATHS = new Set([
  "/menu",
  "/extras",
  "/drinks",
  "/sauces",
  "/hotdogs",
  "/donuts",
  "/bubble-tea",
]);

function enabledFromSettings(value?: any) {
  const settings = value && typeof value === "object" ? value : readSettings();
  return settings?.menu?.burgerStudio?.enabled === true;
}

export default function BurgerStudioEntry() {
  const pathname = usePathname();
  const router = useRouter();
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const sync = (value?: any) => setEnabled(enabledFromSettings(value));
    sync();

    const onSettings = (event: Event) => {
      sync((event as CustomEvent).detail);
    };

    window.addEventListener("bb_settings_changed", onSettings as EventListener);
    window.addEventListener("bb:settings-sync", onSettings as EventListener);
    window.addEventListener("storage", () => sync());

    void fetchAndApplyRemoteSettings()
      .then((next) => sync(next))
      .catch(() => undefined);

    return () => {
      window.removeEventListener(
        "bb_settings_changed",
        onSettings as EventListener,
      );
      window.removeEventListener(
        "bb:settings-sync",
        onSettings as EventListener,
      );
    };
  }, []);

  if (!enabled || !CUSTOMER_MENU_PATHS.has(pathname)) return null;

  return (
    <button
      type="button"
      data-bb-swipe-ignore
      aria-label="Burger Studio öffnen"
      onClick={() => {
        const href = "/burger-studio";
        if (!startAppNavigation(href)) return;
        router.push(href, { scroll: false });
      }}
      className="group fixed right-3 top-[calc(env(safe-area-inset-top)+78px)] z-[45] flex items-center gap-2 rounded-full border border-amber-300/35 bg-black/90 px-3 py-2 text-xs font-black text-white shadow-[0_12px_38px_rgba(0,0,0,.45),0_0_28px_rgba(245,158,11,.13)] backdrop-blur-xl transition hover:border-amber-300/65 sm:right-5 sm:top-[calc(env(safe-area-inset-top)+86px)] sm:px-4 sm:text-sm"
    >
      <span className="grid h-7 w-7 place-items-center rounded-full bg-amber-400 text-base text-black shadow-[0_0_18px_rgba(245,158,11,.28)] transition group-hover:scale-105">
        🔥
      </span>
      <span>Burger Studio</span>
      <span className="text-amber-300">→</span>
    </button>
  );
}
