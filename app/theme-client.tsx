"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { usePathname } from "next/navigation";
import { LS_SETTINGS } from "@/lib/settings";
import {
  getThemePreset,
  resolveActiveTheme,
  themeColor,
  type ResolvedTheme,
  type ThemeId,
} from "@/lib/themes";

function extractSettings(raw: any) {
  if (raw && typeof raw === "object") {
    if (raw.settings && typeof raw.settings === "object") return raw.settings;
    if (raw.data && typeof raw.data === "object") return raw.data;
  }

  return raw && typeof raw === "object" ? raw : {};
}

function readStoredSettings() {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    return raw ? extractSettings(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

function isAdminPath(pathname: string) {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

function isThemeIsolatedPath(pathname: string) {
  return (
    pathname === "/tv" ||
    pathname.startsWith("/tv/") ||
    pathname === "/driver" ||
    pathname.startsWith("/driver/")
  );
}

function applyRootTheme(
  resolved: ResolvedTheme,
  pathname: string,
): ResolvedTheme {
  const admin = isAdminPath(pathname);
  const isolated = isThemeIsolatedPath(pathname);
  const fixedClassic = admin || isolated;
  const activeTheme: ThemeId = fixedClassic ? "classic" : resolved.theme;
  const settings = resolved.settings;
  const root = document.documentElement;
  const body = document.body;
  const showSnow =
    !fixedClassic &&
    settings.snow &&
    (activeTheme === "christmas" || activeTheme === "winter");

  root.setAttribute("data-bb-theme", activeTheme);
  const preset = getThemePreset(activeTheme);
  root.setAttribute("data-bb-theme-effect", preset.effect);
  root.setAttribute(
    "data-bb-effects",
    !fixedClassic && settings.decorationsEnabled ? "1" : "0",
  );
  root.setAttribute(
    "data-bb-motion",
    !fixedClassic && settings.motionEnabled ? "1" : "0",
  );
  root.setAttribute("data-bb-snow", showSnow ? "1" : "0");
  root.setAttribute(
    "data-bb-theme-source",
    admin ? "admin" : isolated ? "route-isolated" : resolved.source,
  );
  root.setAttribute("data-bb-theme-isolated", isolated ? "1" : "0");
  const deviceMemory = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory || 8);
  const lite =
    deviceMemory <= 4 ||
    navigator.hardwareConcurrency <= 4 ||
    window.matchMedia("(max-width: 720px)").matches;
  root.setAttribute("data-bb-performance", lite ? "lite" : "full");

  if (body) {
    for (const className of Array.from(body.classList)) {
      if (className.startsWith("bb-theme-")) body.classList.remove(className);
    }
    body.classList.add(`bb-theme-${activeTheme}`);
  }

  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );

  if (meta) meta.content = themeColor(activeTheme);

  const next: ResolvedTheme = {
    ...resolved,
    theme: activeTheme,
  };

  window.dispatchEvent(
    new CustomEvent("bb_theme_applied", {
      detail: {
        active: activeTheme,
        selected: resolved.theme,
        source: admin
          ? "admin"
          : isolated
            ? "route-isolated"
            : resolved.source,
        scheduleId: resolved.scheduleId,
        scheduleName: resolved.scheduleName,
        snow: showSnow,
      },
    }),
  );

  return next;
}

function motifStyle(index: number): CSSProperties {
  const left = (index * 23 + 7) % 94;
  const top = (index * 37 + 11) % 86;
  const delay = -((index * 1.17) % 8);
  const duration = 8 + (index % 4) * 1.8;
  const size = 13 + (index % 4) * 3;

  return {
    left: `${left}%`,
    top: `${top}%`,
    animationDelay: `${delay}s`,
    animationDuration: `${duration}s`,
    fontSize: `${size}px`,
  };
}

export default function ThemeClient() {
  const pathname = usePathname();
  const [resolved, setResolved] = useState<ResolvedTheme | null>(null);

  useEffect(() => {
    const sync = (input?: any) => {
      const settings = input ? extractSettings(input) : readStoredSettings();
      const next = resolveActiveTheme(settings?.theme, new Date());
      setResolved(applyRootTheme(next, pathname));
    };

    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === LS_SETTINGS) sync();
    };

    const onSettingsChanged = (event: Event) => {
      const custom = event as CustomEvent<any>;
      sync(custom?.detail);
    };

    sync();
    const secondPass = window.setTimeout(() => sync(), 400);
    const scheduleTimer = window.setInterval(() => sync(), 60_000);

    window.addEventListener("storage", onStorage);
    window.addEventListener(
      "bb_settings_changed",
      onSettingsChanged as EventListener,
    );
    window.addEventListener(
      "bb:settings-sync",
      onSettingsChanged as EventListener,
    );

    return () => {
      window.clearTimeout(secondPass);
      window.clearInterval(scheduleTimer);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(
        "bb_settings_changed",
        onSettingsChanged as EventListener,
      );
      window.removeEventListener(
        "bb:settings-sync",
        onSettingsChanged as EventListener,
      );
    };
  }, [pathname]);

  useEffect(() => {
    if (
      !resolved ||
      !resolved.settings.decorationsEnabled ||
      !resolved.settings.motionEnabled ||
      isAdminPath(pathname) ||
      isThemeIsolatedPath(pathname)
    ) {
      return;
    }

    let lastBurstAt = 0;
    const timers = new Set<number>();
    const onClick = (event: MouseEvent) => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      if (Date.now() - lastBurstAt < 280) return;
      const source = event.target;
      if (!(source instanceof Element)) return;
      const target = source.closest(
        ".card-cta,.bb-theme-primary,.bb-btn,.nav-pill,[data-bb-theme-action='primary']",
      );
      if (!(target instanceof HTMLElement) || target.closest("[aria-disabled='true']")) return;

      lastBurstAt = Date.now();
      const preset = getThemePreset(resolved.theme);
      const rect = target.getBoundingClientRect();
      const burst = document.createElement("span");
      burst.className = "bb-theme-burst";
      burst.dataset.effect = preset.effect;
      burst.style.setProperty("--bb-burst-x", `${rect.left + rect.width / 2}px`);
      burst.style.setProperty("--bb-burst-y", `${rect.top + rect.height / 2}px`);

      for (let index = 0; index < 6; index += 1) {
        const spark = document.createElement("i");
        spark.textContent = preset.burst[index % preset.burst.length] || "✦";
        spark.style.setProperty("--bb-burst-angle", `${index * 60}deg`);
        spark.style.setProperty("--bb-burst-distance", `${38 + (index % 3) * 11}px`);
        burst.appendChild(spark);
      }

      document.body.appendChild(burst);
      const timer = window.setTimeout(() => {
        burst.remove();
        timers.delete(timer);
      }, 900);
      timers.add(timer);
    };

    document.addEventListener("click", onClick, { passive: true });
    return () => {
      document.removeEventListener("click", onClick);
      timers.forEach((timer) => window.clearTimeout(timer));
      document.querySelectorAll(".bb-theme-burst").forEach((element) => element.remove());
    };
  }, [pathname, resolved]);

  const decoration = useMemo(() => {
    if (
      !resolved ||
      isAdminPath(pathname) ||
      isThemeIsolatedPath(pathname)
    ) {
      return null;
    }
    if (!resolved.settings.decorationsEnabled) return null;

    const preset = getThemePreset(resolved.theme);
    const showSnow =
      resolved.settings.snow &&
      (resolved.theme === "christmas" || resolved.theme === "winter");
    const motifs = showSnow
      ? ["❄", "·", "✦"]
      : preset.motifs;

    return {
      preset,
      motifs,
      count: preset.density === 2 ? 10 : preset.density === 1 ? 7 : 0,
    };
  }, [pathname, resolved]);

  if (!decoration) return null;

  return (
    <div
      className="bb-theme-decorations"
      data-theme={decoration.preset.id}
      data-effect={decoration.preset.effect}
      aria-hidden="true"
    >
      <div className="bb-theme-garland" />
      <div className="bb-theme-atmosphere bb-theme-atmosphere--one" />
      <div className="bb-theme-atmosphere bb-theme-atmosphere--two" />
      <div className="bb-theme-orbit" />
      <span className="bb-theme-corner bb-theme-corner--left">
        {decoration.preset.cornerLeft}
      </span>
      <span className="bb-theme-corner bb-theme-corner--right">
        {decoration.preset.cornerRight}
      </span>

      <div className="bb-theme-motifs">
        {Array.from({ length: decoration.count }, (_, index) => (
          <span
            key={`${decoration.preset.id}-${index}`}
            className="bb-theme-motif"
            style={motifStyle(index)}
          >
            {decoration.motifs.length
              ? decoration.motifs[index % decoration.motifs.length]
              : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
