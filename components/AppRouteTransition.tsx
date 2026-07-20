"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const MENU_ROUTES = new Set([
  "/menu",
  "/extras",
  "/drinks",
  "/sauces",
  "/hotdogs",
  "/donuts",
  "/bubble-tea",
]);

const START_EVENT = "bb:navigation-start";
const END_EVENT = "bb:navigation-end";
const MAX_WAIT_MS = 12_000;

type NavigationStartDetail = {
  href?: string;
  source?: string;
  scrollToTop?: boolean;
};

function cleanPathFromHref(href: string) {
  try {
    return new URL(href, window.location.origin).pathname;
  } catch {
    return "";
  }
}

function isInternalHref(href: string) {
  try {
    const url = new URL(href, window.location.origin);
    return url.origin === window.location.origin;
  } catch {
    return false;
  }
}

function shouldIgnoreClick(event: MouseEvent, anchor: HTMLAnchorElement) {
  if (event.defaultPrevented) return true;
  if (event.button !== 0) return true;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return true;
  if (anchor.target && anchor.target !== "_self") return true;
  if (anchor.hasAttribute("download")) return true;

  const href = anchor.getAttribute("href") || "";
  if (!href || href.startsWith("#")) return true;
  if (href.startsWith("mailto:") || href.startsWith("tel:")) return true;
  if (!isInternalHref(href)) return true;

  const next = new URL(href, window.location.origin);
  const current = new URL(window.location.href);

  return (
    next.pathname === current.pathname &&
    next.search === current.search &&
    next.hash === current.hash
  );
}

export function startAppNavigation(detail: NavigationStartDetail = {}) {
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent<NavigationStartDetail>(START_EVENT, {
      detail,
    }),
  );
}

export default function AppRouteTransition() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchKey = searchParams?.toString() || "";

  const [pending, setPending] = useState(false);
  const timerRef = useRef<number | null>(null);
  const pendingHrefRef = useRef("");
  const shouldScrollTopRef = useRef(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    const finish = () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      document.documentElement.classList.remove("bb-route-pending");
      document.body.classList.remove("bb-route-pending");

      setPending(false);
      pendingHrefRef.current = "";

      window.dispatchEvent(new CustomEvent(END_EVENT));
    };

    const begin = (detail: NavigationStartDetail = {}) => {
      const href = String(detail.href || "");
      const targetPath = cleanPathFromHref(href);

      pendingHrefRef.current = href;
      shouldScrollTopRef.current =
        detail.scrollToTop !== false &&
        Boolean(targetPath && MENU_ROUTES.has(targetPath));

      document.documentElement.classList.add("bb-route-pending");
      document.body.classList.add("bb-route-pending");
      setPending(true);

      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }

      timerRef.current = window.setTimeout(finish, MAX_WAIT_MS);
    };

    const onStart = (event: Event) => {
      const custom = event as CustomEvent<NavigationStartDetail>;
      begin(custom.detail || {});
    };

    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;

      if (!anchor || shouldIgnoreClick(event, anchor)) return;

      begin({
        href: anchor.href,
        source: "anchor",
        scrollToTop: true,
      });
    };

    const onExternalReturn = () => {
      // Standalone PWA pages can be restored from the browser cache after
      // Stripe or WhatsApp. Always clear a stale route transition overlay.
      finish();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") finish();
    };

    window.addEventListener(START_EVENT, onStart as EventListener);
    window.addEventListener("pageshow", onExternalReturn);
    window.addEventListener("focus", onExternalReturn);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("click", onDocumentClick, true);

    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }

      window.removeEventListener(START_EVENT, onStart as EventListener);
      window.removeEventListener("pageshow", onExternalReturn);
      window.removeEventListener("focus", onExternalReturn);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("click", onDocumentClick, true);
    };
  }, []);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }

    let frameOne = 0;
    let frameTwo = 0;
    let finishTimer = 0;

    frameOne = window.requestAnimationFrame(() => {
      if (shouldScrollTopRef.current) {
        window.scrollTo({
          top: 0,
          left: 0,
          behavior: "auto",
        });
      }

      frameTwo = window.requestAnimationFrame(() => {
        document.documentElement.classList.remove("bb-route-pending");
        document.body.classList.remove("bb-route-pending");
        document.documentElement.classList.add("bb-route-arrived");

        setPending(false);

        finishTimer = window.setTimeout(() => {
          document.documentElement.classList.remove("bb-route-arrived");
          window.dispatchEvent(new CustomEvent(END_EVENT));
        }, 260);
      });
    });

    return () => {
      window.cancelAnimationFrame(frameOne);
      window.cancelAnimationFrame(frameTwo);
      window.clearTimeout(finishTimer);
    };
  }, [pathname, searchKey]);

  return (
    <div
      aria-hidden="true"
      className={`bb-route-progress ${pending ? "bb-route-progress--visible" : ""}`}
    >
      <span className="bb-route-progress__bar" />
    </div>
  );
}
