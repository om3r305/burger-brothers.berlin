const EDGE_PX = 22;

// Safari can start its own back/forward preview before touchmove is delivered.
// Cancel an eligible edge touch at touchstart; leave middle-of-page category
// gestures, multi-touch and interactive controls to their existing handlers.
// Native WKWebView gestures must also be disabled in the iOS app itself.
export function installBrowserHistorySwipeGuard() {
  const onTouchStart = (event: TouchEvent) => {
    const width = Math.min(window.innerWidth, document.documentElement.clientWidth || window.innerWidth);
    if (width > 900 || !event.cancelable || event.touches.length !== 1) return;
    const x = event.touches[0].clientX;
    if (x > EDGE_PX && x < width - EDGE_PX) return;
    if (event.target instanceof Element && event.target.closest(
      "a,button,input,textarea,select,label,[contenteditable='true']",
    )) return;
    event.preventDefault();
  };

  document.addEventListener("touchstart", onTouchStart, { capture: true, passive: false });
  return () => document.removeEventListener("touchstart", onTouchStart, true);
}
