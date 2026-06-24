"use client";
import { useEffect, useState } from "react";
import { readSettings } from "@/lib/settings";
import Snow from "@/components/Snow";

export default function ThemeClient() {
  const [snowOn, setSnowOn] = useState(false);

  useEffect(() => {
    const s = readSettings();
    const theme = s.theme?.active || "classic";
    // <html data-theme="...">
    document.documentElement.dataset.theme = theme;

    // sayfa logosu (opsiyonel)
    const logo = s.theme?.logos?.[theme];
    if (logo) (window as any).__APP_LOGO_URL__ = logo;

    setSnowOn(!!s.theme?.snow || theme === "christmas");
  }, []);

  return snowOn ? <Snow /> : null;
}
