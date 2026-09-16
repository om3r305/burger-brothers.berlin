"use client";

import { useEffect } from "react";

export default function KasaScrollGuard() {
  useEffect(() => {
    const root = document.getElementById("bb-kasa-page");
    if (!root) return;

    const scroller = root.querySelector("main") as HTMLElement | null;
    if (!scroller) return;

    // iOS/Android can re-anchor the inner scroller when the Lifa summary
    // appears below the checkbox. Keep the cashier exactly where it was.
    scroller.style.overflowAnchor = "none";

    const style = document.createElement("style");
    style.setAttribute("data-kasa-scroll-guard", "true");
    style.textContent = `
      #bb-kasa-page main { overflow-anchor: none !important; }
      #bb-kasa-page .global-lifa { position: relative; overflow-anchor: none !important; }
      #bb-kasa-page .global-lifa input {
        position: absolute !important;
        top: 10px !important;
        left: 10px !important;
        width: 1px !important;
        height: 1px !important;
        margin: 0 !important;
        opacity: 0 !important;
      }
    `;
    document.head.appendChild(style);

    let savedTop = scroller.scrollTop;
    let restoreTimerA: ReturnType<typeof setTimeout> | null = null;
    let restoreTimerB: ReturnType<typeof setTimeout> | null = null;

    const remember = (event: Event) => {
      const target = event.target as Element | null;
      if (!target?.closest(".global-lifa")) return;
      savedTop = scroller.scrollTop;
    };

    const restore = (event: Event) => {
      const target = event.target as HTMLInputElement | null;
      if (!target?.matches(".global-lifa input")) return;

      const top = savedTop;
      target.blur();

      requestAnimationFrame(() => {
        scroller.scrollTop = top;
        requestAnimationFrame(() => {
          scroller.scrollTop = top;
        });
      });

      restoreTimerA = setTimeout(() => {
        scroller.scrollTop = top;
      }, 40);
      restoreTimerB = setTimeout(() => {
        scroller.scrollTop = top;
      }, 120);
    };

    root.addEventListener("pointerdown", remember, true);
    root.addEventListener("touchstart", remember, { capture: true, passive: true });
    root.addEventListener("change", restore, true);

    return () => {
      root.removeEventListener("pointerdown", remember, true);
      root.removeEventListener("touchstart", remember, true);
      root.removeEventListener("change", restore, true);
      if (restoreTimerA) clearTimeout(restoreTimerA);
      if (restoreTimerB) clearTimeout(restoreTimerB);
      style.remove();
    };
  }, []);

  return null;
}
