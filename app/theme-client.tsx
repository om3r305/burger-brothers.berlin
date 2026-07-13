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

function applyRootTheme(
  resolved: ResolvedTheme,
  pathname: string,
): ResolvedTheme {
  const admin = isAdminPath(pathname);
  const activeTheme: ThemeId = admin ? "classic" : resolved.theme;
  const settings = resolved.settings;
  const root = document.documentElement;
  const body = document.body;
  const showSnow =
    !admin &&
    settings.snow &&
    (activeTheme === "christmas" || activeTheme === "winter");

  root.setAttribute("data-bb-theme", activeTheme);
  root.setAttribute(
    "data-bb-effects",
    !admin && settings.decorationsEnabled ? "1" : "0",
  );
  root.setAttribute(
    "data-bb-motion",
    !admin && settings.motionEnabled ? "1" : "0",
  );
  root.setAttribute("data-bb-snow", showSnow ? "1" : "0");
  root.setAttribute("data-bb-theme-source", admin ? "admin" : resolved.source);

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
        source: admin ? "admin" : resolved.source,
        scheduleId: resolved.scheduleId,
        scheduleName: resolved.scheduleName,
        snow: showSnow,
      },
    }),
  );

  return next;
}

function particleStyle(index: number): CSSProperties {
  const left = (index * 17 + 7) % 96;
  const delay = -((index * 1.37) % 12);
  const duration = 9 + (index % 6) * 1.7;
  const size = 14 + (index % 4) * 4;

  return {
    left: `${left}%`,
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

  const decoration = useMemo(() => {
    if (!resolved || isAdminPath(pathname)) return null;
    if (!resolved.settings.decorationsEnabled) return null;

    const preset = getThemePreset(resolved.theme);
    const showSnow =
      resolved.settings.snow &&
      (resolved.theme === "christmas" || resolved.theme === "winter");
    const particles = showSnow
      ? ["❄", "·", "✦"]
      : preset.particles;

    return {
      preset,
      particles,
    };
  }, [pathname, resolved]);

  if (!decoration) return null;

  return (
    <div
      className="bb-theme-decorations"
      data-theme={decoration.preset.id}
      aria-hidden="true"
    >
      <div className="bb-theme-garland" />
      <div className="bb-theme-atmosphere" />
      <span className="bb-theme-corner bb-theme-corner--left">
        {decoration.preset.cornerLeft}
      </span>
      <span className="bb-theme-corner bb-theme-corner--right">
        {decoration.preset.cornerRight}
      </span>

      <div className="bb-theme-particles">
        {Array.from({ length: 18 }, (_, index) => (
          <span
            key={`${decoration.preset.id}-${index}`}
            className="bb-theme-particle"
            style={particleStyle(index)}
          >
            {decoration.particles.length
              ? decoration.particles[index % decoration.particles.length]
              : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
