"use client";

import { useEffect } from "react";
import { readSettings } from "@/lib/settings";

export default function ThemeApply() {
  useEffect(() => {
    const s = readSettings();
    const theme = s?.theme?.name || "default";
    const root = document.documentElement;
    root.classList.remove("theme-default","theme-christmas","theme-halloween","theme-neon");
    root.classList.add(`theme-${theme}`);

    // Snow effect for Christmas
    const wantSnow = theme === "christmas" && (s?.theme?.christmas?.snow ?? true);
    let snowTimer: any = null;
    let snowEl: HTMLDivElement | null = null;

    if (wantSnow) {
      snowEl = document.createElement("div");
      snowEl.setAttribute("id", "snow-layer");
      snowEl.style.position = "fixed";
      snowEl.style.pointerEvents = "none";
      snowEl.style.left = "0"; snowEl.style.top = "0";
      snowEl.style.width = "100%"; snowEl.style.height = "100%";
      snowEl.style.zIndex = "50";
      document.body.appendChild(snowEl);

      const makeFlake = () => {
        if (!snowEl) return;
        const f = document.createElement("span");
        f.textContent = "❄";
        f.style.position = "absolute";
        f.style.left = Math.random() * 100 + "vw";
        f.style.top = "-5%";
        f.style.opacity = String(0.6 + Math.random() * 0.4);
        f.style.fontSize = (12 + Math.random() * 16) + "px";
        const dur = 6 + Math.random() * 8;
        f.style.transition = `transform ${dur}s linear, opacity ${dur}s linear`;
        snowEl.appendChild(f);
        requestAnimationFrame(() => {
          f.style.transform = `translate(${(Math.random() * 20 - 10)}vw, 105vh)`;
          f.style.opacity = "0.2";
        });
        setTimeout(() => f.remove(), dur * 1000 + 500);
      };

      snowTimer = setInterval(makeFlake, 350);
    }

    return () => {
      root.classList.remove("theme-default","theme-christmas","theme-halloween","theme-neon");
      if (snowTimer) clearInterval(snowTimer);
      const exist = document.getElementById("snow-layer");
      if (exist) exist.remove();
    };
  }, []);

  return null;
}
