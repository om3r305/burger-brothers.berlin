// components/theme/ThemeProvider.tsx
"use client";

import { createContext, useContext, useEffect } from "react";
import { useSettings } from "@/lib/useSettings";


type TCtx = { logoUrl?: string; themeId: string };
const ThemeCtx = createContext<TCtx>({
  logoUrl: "/logo-burger-brothers.png",
  themeId: "classic",
});

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();

  const theme: any = (settings as any)?.theme ?? {};
  const themeId = String(theme.id ?? "classic");
  const logoUrl = String(theme.logoUrl ?? "/logo-burger-brothers.png");
  const showSnow = !!theme.snow;

  useEffect(() => {
    const el = document.documentElement;
    el.classList.remove("theme-classic", "theme-christmas", "theme-halloween", "theme-neon");
    el.classList.add(`theme-${themeId}`);
  }, [themeId]);

  return (
    <ThemeCtx.Provider value={{ logoUrl, themeId }}>
      {showSnow}
      {children}
    </ThemeCtx.Provider>
  );
}

export function useThemeLogo() {
  return useContext(ThemeCtx)?.logoUrl || "/logo-burger-brothers.png";
}
