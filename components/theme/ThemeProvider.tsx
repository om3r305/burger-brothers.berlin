"use client";
import { createContext, useContext, useEffect } from "react";
import { useSettings } from "@/lib/settings";
import Snow from "@/components/theme/effects/Snow";

type TCtx = { logoUrl?: string; themeId: string };
const ThemeCtx = createContext<TCtx>({ logoUrl: "/logo-burger-brothers.png", themeId: "classic" });

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const themeId = settings.theme.id;

  useEffect(() => {
    const el = document.documentElement;
    el.classList.remove("theme-classic","theme-christmas","theme-halloween","theme-neon");
    el.classList.add(`theme-${themeId}`);
  }, [themeId]);

  return (
    <ThemeCtx.Provider value={{ logoUrl: settings.theme.logoUrl, themeId }}>
      {/* Christmas → snow toggle’ına göre efekt */}
      {settings.theme.snow && <Snow />}
      {children}
    </ThemeCtx.Provider>
  );
}

export function useThemeLogo() {
  return useContext(ThemeCtx)?.logoUrl || "/logo-burger-brothers.png";
}
