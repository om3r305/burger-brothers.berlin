"use client";

import { useEffect } from "react";

export default function KasaScrollGuard() {
  useEffect(() => {
    const root = document.getElementById("bb-kasa-page");
    if (!root) return;

    const scroller = root.querySelector("main") as HTMLElement | null;
    if (!scroller) return;

    // Keep the cashier app independent from the browser's page-level overscroll.
    // This prevents Android/iOS pull-to-refresh from wiping an in-progress bill.
    const html = document.documentElement;
    const body = document.body;
    const oldHtmlOverscroll = html.style.overscrollBehaviorY;
    const oldBodyOverscroll = body.style.overscrollBehaviorY;
    html.style.overscrollBehaviorY = "none";
    body.style.overscrollBehaviorY = "none";

    // iOS/Android can re-anchor the inner scroller when the Lifa summary
    // appears below the checkbox. Keep the cashier exactly where it was.
    scroller.style.overflowAnchor = "none";
    scroller.style.overscrollBehaviorY = "contain";

    const style = document.createElement("style");
    style.setAttribute("data-kasa-scroll-guard", "true");
    style.textContent = `
      html:has(#bb-kasa-page),
      body:has(#bb-kasa-page),
      #bb-kasa-page {
        overscroll-behavior-y: none !important;
      }
      #bb-kasa-page main {
        overflow-anchor: none !important;
        overscroll-behavior-y: contain !important;
        -webkit-overflow-scrolling: touch;
      }
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
    let touchStartX = 0;
    let touchStartY = 0;

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

    const rememberTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      touchStartX = event.touches[0].clientX;
      touchStartY = event.touches[0].clientY;
    };

    const blockPullToRefresh = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;

      const touch = event.touches[0];
      const deltaX = touch.clientX - touchStartX;
      const deltaY = touch.clientY - touchStartY;

      // Preserve horizontal category swipes. Only intercept a vertical pull-down.
      if (deltaY <= 0 || Math.abs(deltaY) <= Math.abs(deltaX)) return;

      const target = event.target as Element | null;
      const startedInsideScroller = Boolean(target?.closest("main"));

      // If the gesture begins on the fixed header/top controls, or the inner
      // content is already at its top edge, there is nowhere for the gesture
      // to scroll. Preventing it here stops the browser's refresh gesture.
      if (!startedInsideScroller || scroller.scrollTop <= 0) {
        event.preventDefault();
      }
    };

    root.addEventListener("pointerdown", remember, true);
    root.addEventListener("touchstart", remember, { capture: true, passive: true });
    root.addEventListener("change", restore, true);
    root.addEventListener("touchstart", rememberTouchStart, { capture: true, passive: true });
    root.addEventListener("touchmove", blockPullToRefresh, { capture: true, passive: false });

    return () => {
      root.removeEventListener("pointerdown", remember, true);
      root.removeEventListener("touchstart", remember, true);
      root.removeEventListener("change", restore, true);
      root.removeEventListener("touchstart", rememberTouchStart, true);
      root.removeEventListener("touchmove", blockPullToRefresh, true);
      if (restoreTimerA) clearTimeout(restoreTimerA);
      if (restoreTimerB) clearTimeout(restoreTimerB);
      html.style.overscrollBehaviorY = oldHtmlOverscroll;
      body.style.overscrollBehaviorY = oldBodyOverscroll;
      style.remove();
    };
  }, []);

  return null;
}
