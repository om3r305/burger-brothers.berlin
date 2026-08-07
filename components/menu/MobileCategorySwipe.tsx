"use client";

import { useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { startAppNavigation } from "@/components/AppRouteTransition";
import { warmCategoryData } from "@/lib/public-data-cache";
import { fetchAndApplyRemoteSettings, readSettings } from "@/lib/settings";
import {
  createDefaultMenuTransitionSettings,
  normalizeMenuTransitionSettings,
  resolveMenuTransitionStyle,
  type MenuTransitionSettings,
  type MenuTransitionStyle,
} from "@/lib/menu-transitions";
import {
  MENU_NAV_ITEMS,
  MENU_NAV_KEYS,
  MENU_NAV_LABELS,
  MENU_NAV_ROUTES,
  type MenuNavKey,
} from "@/lib/menu-navigation";

const MENU_PATHS = new Set([
  "/menu",
  "/extras",
  "/drinks",
  "/sauces",
  "/hotdogs",
  "/donuts",
  "/bubble-tea",
]);

const CATEGORY_VIDEOS: Record<MenuNavKey, string> = {
  burger: "/flames/flame-loop.mp4",
  vegan: "/swipe-transitions/vegan.mp4",
  extras: "/swipe-transitions/extras.mp4",
  drinks: "/swipe-transitions/drinks.mp4",
  hotdogs: "/swipe-transitions/hotdogs.mp4",
  sauces: "/swipe-transitions/sauces.mp4",
  donuts: "/swipe-transitions/donuts.mp4",
  bubbletea: "/swipe-transitions/bubbletea.mp4",
};

const START_EDGE_GUARD_PX = 22;
const AXIS_LOCK_PX = 10;
const COMPLETE_DISTANCE_PX = 72;
const FAST_DISTANCE_PX = 36;
const FAST_VELOCITY_PX_MS = 0.46;
const PREVIEW_DISTANCE_PX = 150;

type Axis = "pending" | "horizontal" | "vertical";
type Direction = "previous" | "next";

function activeThemeId() {
  return document.documentElement.getAttribute("data-bb-theme") || "classic";
}

type GestureState = {
  active: boolean;
  axis: Axis;
  startX: number;
  startY: number;
  lastX: number;
  lastAt: number;
  velocityX: number;
  keys: MenuNavKey[];
  target: MenuNavKey | null;
  direction: Direction | null;
};

function emptyGesture(): GestureState {
  return {
    active: false,
    axis: "pending",
    startX: 0,
    startY: 0,
    lastX: 0,
    lastAt: 0,
    velocityX: 0,
    keys: [],
    target: null,
    direction: null,
  };
}

function isMenuNavKey(value: string): value is MenuNavKey {
  return (MENU_NAV_KEYS as readonly string[]).includes(value);
}

function menuKeyForLocation(
  pathname: string,
  searchParams: URLSearchParams | null,
): MenuNavKey | null {
  if (pathname === "/extras") return "extras";
  if (pathname === "/drinks") return "drinks";
  if (pathname === "/sauces") return "sauces";
  if (pathname === "/hotdogs") return "hotdogs";
  if (pathname === "/donuts") return "donuts";
  if (pathname === "/bubble-tea") return "bubbletea";

  if (pathname !== "/menu") return null;

  const raw = String(
    searchParams?.get("cat") || searchParams?.get("tab") || "burger",
  )
    .trim()
    .toLowerCase();

  return isMenuNavKey(raw) ? raw : "burger";
}

function visibleMenuKeysFromPage(currentKey: MenuNavKey): MenuNavKey[] {
  const found = Array.from(
    document.querySelectorAll<HTMLElement>("[data-bb-tab-key]"),
  )
    .map((element) => String(element.dataset.bbTabKey || ""))
    .filter(isMenuNavKey);

  const unique = Array.from(new Set(found));

  if (unique.length > 1 && unique.includes(currentKey)) {
    return unique;
  }

  return MENU_NAV_ITEMS.map((item) => item.key);
}

function isHorizontallyScrollable(element: Element) {
  let node: Element | null = element;

  while (node && node !== document.body) {
    if (node instanceof HTMLElement) {
      const style = window.getComputedStyle(node);
      const overflowX = style.overflowX;

      if (
        (overflowX === "auto" || overflowX === "scroll") &&
        node.scrollWidth > node.clientWidth + 2
      ) {
        return true;
      }
    }

    node = node.parentElement;
  }

  return false;
}

function shouldIgnoreGestureTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return true;

  if (
    target.closest(
      [
        "a",
        "button",
        "input",
        "textarea",
        "select",
        "option",
        "label",
        "[contenteditable='true']",
        "[role='dialog']",
        "[aria-modal='true']",
        "[data-bb-swipe-ignore]",
        ".bb-product-modal",
        ".bb-modal-shell",
        ".bb-tabs-scroll",
      ].join(","),
    )
  ) {
    return true;
  }

  return isHorizontallyScrollable(target);
}

function supportsMobileSwipe() {
  const viewportWidth = Math.min(
    window.innerWidth,
    document.documentElement.clientWidth || window.innerWidth,
  );

  return viewportWidth <= 900;
}

function clampProgress(value: number) {
  return Math.max(0, Math.min(1, value));
}

type RevealGeometry = {
  clip: string;
  outline: string;
  revealWidth: string;
};

function edgeRevealGeometry(
  progress: number,
  direction: Direction,
  style: MenuTransitionStyle,
  committed: boolean,
): RevealGeometry {
  const normalized = clampProgress(progress);
  const eased = 1 - Math.pow(1 - normalized, committed ? 1.18 : 1.5);
  const previewWidths: Record<MenuTransitionStyle, number> = {
    "edge-glow": 6.5,
    "color-wave": 42,
    "soft-ribbon": 32,
    "cinematic-video": 68,
    "theme-auto": 38,
    minimal: 18,
  };
  const committedWidth = style === "cinematic-video" ? 100 : previewWidths[style] + 4;
  const width =
    style === "edge-glow"
      ? normalized > 0
        ? 6.5
        : 0.001
      : Math.max(
          0.001,
          (committed ? committedWidth : previewWidths[style]) * eased,
        );
  const boundaryX = direction === "previous" ? width : 100 - width;
  const clip =
    direction === "previous"
      ? `polygon(0% 0%, ${width.toFixed(3)}% 0%, ${width.toFixed(3)}% 100%, 0% 100%)`
      : `polygon(${(100 - width).toFixed(3)}% 0%, 100% 0%, 100% 100%, ${(100 - width).toFixed(3)}% 100%)`;

  return {
    clip,
    outline: `M ${boundaryX.toFixed(3)},0 L ${boundaryX.toFixed(3)},100`,
    revealWidth: `${width.toFixed(3)}%`,
  };
}

function activeThemePalette(fallback: string) {
  const styles = window.getComputedStyle(document.documentElement);
  const read = (name: string, defaultValue: string) =>
    styles.getPropertyValue(name).trim() || defaultValue;

  return {
    primary: read("--bb-accent", fallback),
    secondary: read("--bb-accent-2", fallback),
    tertiary: read("--bb-accent-3", fallback),
    background: read("--bb-page-bg", "#050505"),
  };
}

export default function MobileCategorySwipe() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchKey = searchParams?.toString() || "";
  const router = useRouter();

  const currentKey = useMemo(
    () => menuKeyForLocation(pathname, searchParams),
    [pathname, searchKey, searchParams],
  );

  const overlayRef = useRef<HTMLDivElement | null>(null);
  const labelRef = useRef<HTMLSpanElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const edgeGlowRef = useRef<SVGPathElement | null>(null);
  const edgeCoreRef = useRef<SVGPathElement | null>(null);
  const activeVideoKeyRef = useRef<MenuNavKey | null>(null);
  const gestureRef = useRef<GestureState>(emptyGesture());
  const navigationLockedRef = useRef(false);
  const primedRef = useRef(new Set<MenuNavKey>());
  const resetTimerRef = useRef<number | null>(null);
  const transitionSettingsRef = useRef<MenuTransitionSettings>(
    createDefaultMenuTransitionSettings(),
  );

  useEffect(() => {
    const overlay = overlayRef.current;

    const applySettings = (raw?: unknown) => {
      const incoming =
        raw && typeof raw === "object"
          ? (raw as { menuTransitions?: unknown }).menuTransitions
          : readSettings().menuTransitions;
      const next = normalizeMenuTransitionSettings(incoming);
      transitionSettingsRef.current = next;

      if (overlay) {
        overlay.style.setProperty("--bb-swipe-duration", `${next.durationMs}ms`);
        overlay.style.setProperty(
          "--bb-swipe-shadow-strength",
          (next.shadowStrength / 100).toFixed(2),
        );
        overlay.style.setProperty(
          "--bb-swipe-shadow-percent",
          `${Math.round(28 + next.shadowStrength * 0.52)}%`,
        );
        overlay.style.setProperty(
          "--bb-swipe-shadow-soft-percent",
          `${Math.round(10 + next.shadowStrength * 0.24)}%`,
        );
        overlay.dataset.enabled = next.enabled ? "true" : "false";
        overlay.dataset.labelEnabled = next.labelEnabled ? "true" : "false";

        if (!next.enabled) {
          overlay.dataset.visible = "false";
          videoRef.current?.pause();
        }
      }
    };

    const onSettings = (event: Event) => {
      applySettings((event as CustomEvent).detail);
    };

    applySettings();

    void fetchAndApplyRemoteSettings()
      .then((next) => applySettings(next))
      .catch(() => undefined);

    window.addEventListener("bb_settings_changed", onSettings as EventListener);
    window.addEventListener("bb:settings-sync", onSettings as EventListener);

    return () => {
      window.removeEventListener("bb_settings_changed", onSettings as EventListener);
      window.removeEventListener("bb:settings-sync", onSettings as EventListener);
    };
  }, []);

  useEffect(() => {
    const overlay = overlayRef.current;
    const video = videoRef.current;

    if (overlay) {
      overlay.dataset.visible = "false";
      overlay.dataset.committed = "false";
      overlay.dataset.dragging = "false";
      overlay.dataset.videoReady = "false";
      const emptyGeometry = edgeRevealGeometry(
        0,
        "previous",
        "edge-glow",
        false,
      );
      overlay.style.setProperty("--bb-swipe-clip", emptyGeometry.clip);
      overlay.style.setProperty(
        "--bb-swipe-reveal-width",
        emptyGeometry.revealWidth,
      );
      edgeGlowRef.current?.setAttribute("d", "");
      edgeCoreRef.current?.setAttribute("d", "");
      overlay.style.setProperty("--bb-swipe-label-inset", "7vw");
      overlay.style.setProperty("--bb-swipe-label-scale", "0.92");
      overlay.style.setProperty("--bb-swipe-label-shift", "0px");
      overlay.style.setProperty("--bb-swipe-scene-opacity", "0");
      overlay.style.setProperty("--bb-swipe-label-opacity", "0");
      overlay.style.setProperty("--bb-swipe-video-opacity", "0");
      overlay.style.setProperty("--bb-swipe-edge-opacity", "0");
    }

    if (video) {
      video.pause();
    }

    gestureRef.current = emptyGesture();
  }, [pathname, searchKey]);

  useEffect(() => {
    const unlock = () => {
      navigationLockedRef.current = false;
    };

    window.addEventListener("bb:navigation-end", unlock as EventListener);

    return () => {
      window.removeEventListener(
        "bb:navigation-end",
        unlock as EventListener,
      );
    };
  }, []);

  useEffect(() => {
    if (!currentKey || !MENU_PATHS.has(pathname)) return;

    const overlay = overlayRef.current;
    const label = labelRef.current;
    const video = videoRef.current;

    const setReveal = (
      progress: number,
      direction: Direction,
      style: MenuTransitionStyle,
      committed = false,
    ) => {
      if (!overlay) return;

      const normalized = clampProgress(progress);
      const eased = 1 - Math.pow(1 - normalized, 1.35);
      const labelInset =
        style === "cinematic-video" ? Math.min(24, 6 + eased * 16) : 5 + eased * 4;
      const labelScale = 0.95 + eased * 0.05;
      const glowStrength = Math.pow(eased, 0.9);
      const geometry = edgeRevealGeometry(
        normalized,
        direction,
        style,
        committed,
      );

      overlay.style.setProperty("--bb-swipe-progress", eased.toFixed(3));
      overlay.style.setProperty(
        "--bb-swipe-color-strength",
        (0.1 + glowStrength * 0.9).toFixed(3),
      );
      overlay.style.setProperty(
        "--bb-swipe-glow-blur",
        `${(5 + glowStrength * 23).toFixed(2)}px`,
      );
      overlay.style.setProperty(
        "--bb-swipe-brightness",
        (0.72 + glowStrength * 0.48).toFixed(3),
      );
      overlay.style.setProperty(
        "--bb-swipe-saturation",
        (0.82 + glowStrength * 0.58).toFixed(3),
      );
      overlay.style.setProperty("--bb-swipe-clip", geometry.clip);
      overlay.style.setProperty(
        "--bb-swipe-reveal-width",
        geometry.revealWidth,
      );
      edgeGlowRef.current?.setAttribute("d", geometry.outline);
      edgeCoreRef.current?.setAttribute("d", geometry.outline);
      overlay.style.setProperty(
        "--bb-swipe-label-inset",
        `${labelInset.toFixed(2)}vw`,
      );
      overlay.style.setProperty(
        "--bb-swipe-label-scale",
        labelScale.toFixed(3),
      );
      overlay.style.setProperty(
        "--bb-swipe-label-shift",
        `${((1 - eased) * (direction === "previous" ? -22 : 22)).toFixed(2)}px`,
      );
    };

    const stopVideo = () => {
      if (!video) return;
      video.pause();
    };

    const startVideo = (target: MenuNavKey) => {
      if (!video || !overlay) return;

      const source = CATEGORY_VIDEOS[target];

      if (activeVideoKeyRef.current !== target || video.getAttribute("src") !== source) {
        activeVideoKeyRef.current = target;
        overlay.dataset.videoReady = "false";
        video.pause();
        video.src = source;
        video.load();
      }

      video.muted = true;
      video.playsInline = true;
      video.loop = true;

      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === "function") {
        void playPromise.catch(() => undefined);
      }
    };

    const hidePreview = (immediate = false) => {
      if (!overlay) return;

      if (resetTimerRef.current) {
        window.clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }

      if (immediate) {
        overlay.dataset.instant = "true";
      }

      overlay.dataset.visible = "false";
      overlay.dataset.committed = "false";
      overlay.dataset.dragging = "false";
      const resetDirection: Direction =
        overlay.dataset.direction === "previous" ? "previous" : "next";
      const resetStyle = (overlay.dataset.style ||
        "edge-glow") as MenuTransitionStyle;
      const emptyGeometry = edgeRevealGeometry(
        0,
        resetDirection,
        resetStyle,
        false,
      );
      overlay.style.setProperty("--bb-swipe-clip", emptyGeometry.clip);
      overlay.style.setProperty(
        "--bb-swipe-reveal-width",
        emptyGeometry.revealWidth,
      );
      edgeGlowRef.current?.setAttribute("d", emptyGeometry.outline);
      edgeCoreRef.current?.setAttribute("d", emptyGeometry.outline);
      overlay.style.setProperty("--bb-swipe-label-inset", "7vw");
      overlay.style.setProperty("--bb-swipe-label-scale", "0.92");
      overlay.style.setProperty("--bb-swipe-label-shift", "0px");
      overlay.style.setProperty("--bb-swipe-scene-opacity", "0");
      overlay.style.setProperty("--bb-swipe-label-opacity", "0");
      overlay.style.setProperty("--bb-swipe-video-opacity", "0");
      overlay.style.setProperty("--bb-swipe-edge-opacity", "0");

      stopVideo();

      if (immediate) {
        window.requestAnimationFrame(() => {
          overlay.dataset.instant = "false";
        });
      }
    };

    const primeTarget = (target: MenuNavKey) => {
      if (primedRef.current.has(target)) return;
      primedRef.current.add(target);

      const href = MENU_NAV_ROUTES[target];

      try {
        router.prefetch(href.split("?")[0]);
      } catch {}

      void warmCategoryData(target).catch(() => undefined);
    };

    const showPreview = (
      target: MenuNavKey,
      direction: Direction,
      progress: number,
      dragging = true,
    ) => {
      if (!overlay || !label) return;

      const settings = transitionSettingsRef.current;

      if (!settings.enabled) {
        hidePreview();
        return;
      }

      const normalized = clampProgress(progress);
      const style = resolveMenuTransitionStyle(settings, target);
      const categoryAccent = settings.categoryColors[target];
      const themePalette = activeThemePalette(categoryAccent);
      const accent = style === "theme-auto" ? themePalette.primary : categoryAccent;
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const displayStyle = reducedMotion ? "minimal" : style;
      const sceneOpacity = clampProgress(
        (displayStyle === "minimal" ? 0.08 : 0.14) + normalized * 0.86,
      );
      const labelOpacity = settings.labelEnabled
        ? clampProgress(0.32 + normalized * 2.4)
        : 0;
      const videoOpacity =
        displayStyle === "cinematic-video"
          ? clampProgress((normalized - 0.08) * 1.24)
          : 0;
      const edgeOpacity =
        displayStyle === "minimal"
          ? clampProgress(normalized * 0.55)
          : clampProgress((normalized - 0.03) * 1.45);

      overlay.dataset.visible = "true";
      overlay.dataset.committed = "false";
      overlay.dataset.dragging = dragging ? "true" : "false";
      overlay.dataset.direction = direction;
      overlay.dataset.category = target;
      overlay.dataset.style = displayStyle;
      overlay.dataset.theme = activeThemeId();
      overlay.style.setProperty("--bb-swipe-accent", accent);
      overlay.style.setProperty(
        "--bb-swipe-accent-2",
        style === "theme-auto" ? themePalette.secondary : categoryAccent,
      );
      overlay.style.setProperty(
        "--bb-swipe-accent-3",
        style === "theme-auto" ? themePalette.tertiary : categoryAccent,
      );
      overlay.style.setProperty("--bb-swipe-theme-bg", themePalette.background);
      overlay.style.setProperty(
        "--bb-swipe-scene-opacity",
        sceneOpacity.toFixed(3),
      );
      overlay.style.setProperty(
        "--bb-swipe-label-opacity",
        labelOpacity.toFixed(3),
      );
      overlay.style.setProperty(
        "--bb-swipe-video-opacity",
        videoOpacity.toFixed(3),
      );
      overlay.style.setProperty(
        "--bb-swipe-edge-opacity",
        edgeOpacity.toFixed(3),
      );

      setReveal(normalized, direction, displayStyle);
      label.textContent = MENU_NAV_LABELS[target];

      if (displayStyle === "cinematic-video") {
        startVideo(target);
      } else {
        stopVideo();
        overlay.dataset.videoReady = "false";
      }
    };

    const targetForDelta = (
      keys: MenuNavKey[],
      deltaX: number,
    ): { target: MenuNavKey | null; direction: Direction } => {
      const currentIndex = keys.indexOf(currentKey);
      const direction: Direction = deltaX < 0 ? "next" : "previous";
      const targetIndex =
        direction === "next" ? currentIndex + 1 : currentIndex - 1;

      return {
        direction,
        target:
          currentIndex >= 0 && targetIndex >= 0 && targetIndex < keys.length
            ? keys[targetIndex]
            : null,
      };
    };

    const navigateTo = (target: MenuNavKey, direction: Direction) => {
      if (navigationLockedRef.current) return;

      navigationLockedRef.current = true;
      const href = MENU_NAV_ROUTES[target];

      showPreview(target, direction, 1);

      if (overlay) {
        overlay.dataset.committed = "true";
        overlay.dataset.dragging = "false";
        const style = (overlay.dataset.style ||
          "edge-glow") as MenuTransitionStyle;
        setReveal(1, direction, style, true);
      }

      startAppNavigation({
        href,
        source: "menu-swipe",
        scrollToTop: true,
      });

      router.push(href, {
        scroll: false,
      });

      resetTimerRef.current = window.setTimeout(() => {
        navigationLockedRef.current = false;
        hidePreview();
      }, transitionSettingsRef.current.durationMs + 480);
    };

    const onTouchStart = (event: TouchEvent) => {
      if (
        navigationLockedRef.current ||
        !supportsMobileSwipe() ||
        event.touches.length !== 1 ||
        document.documentElement.classList.contains("bb-route-pending") ||
        shouldIgnoreGestureTarget(event.target)
      ) {
        return;
      }

      const touch = event.touches[0];
      const viewportWidth = window.innerWidth;

      if (
        touch.clientX <= START_EDGE_GUARD_PX ||
        touch.clientX >= viewportWidth - START_EDGE_GUARD_PX
      ) {
        return;
      }

      gestureRef.current = {
        active: true,
        axis: "pending",
        startX: touch.clientX,
        startY: touch.clientY,
        lastX: touch.clientX,
        lastAt: performance.now(),
        velocityX: 0,
        keys: visibleMenuKeysFromPage(currentKey),
        target: null,
        direction: null,
      };
    };

    const onTouchMove = (event: TouchEvent) => {
      const gesture = gestureRef.current;

      if (!gesture.active || event.touches.length !== 1) return;

      const touch = event.touches[0];
      const deltaX = touch.clientX - gesture.startX;
      const deltaY = touch.clientY - gesture.startY;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      if (gesture.axis === "pending") {
        if (Math.max(absX, absY) < AXIS_LOCK_PX) return;

        if (absY > absX * 1.05) {
          gesture.axis = "vertical";
          hidePreview();
          return;
        }

        if (absX > absY * 1.15) {
          gesture.axis = "horizontal";
        } else {
          return;
        }
      }

      if (gesture.axis !== "horizontal") return;

      event.preventDefault();

      const now = performance.now();
      const elapsed = Math.max(1, now - gesture.lastAt);
      gesture.velocityX = (touch.clientX - gesture.lastX) / elapsed;
      gesture.lastX = touch.clientX;
      gesture.lastAt = now;

      const { target, direction } = targetForDelta(
        gesture.keys,
        deltaX,
      );

      gesture.target = target;
      gesture.direction = direction;

      if (!target) {
        hidePreview();
        return;
      }

      primeTarget(target);
      showPreview(
        target,
        direction,
        clampProgress((absX - AXIS_LOCK_PX) / PREVIEW_DISTANCE_PX),
      );
    };

    const finishGesture = (event: TouchEvent) => {
      const gesture = gestureRef.current;

      if (!gesture.active) return;

      const endingTouch = event.changedTouches[0];
      const finalX = endingTouch?.clientX ?? gesture.lastX;
      const deltaX = finalX - gesture.startX;
      const absX = Math.abs(deltaX);
      const fastEnough =
        absX >= FAST_DISTANCE_PX &&
        Math.abs(gesture.velocityX) >= FAST_VELOCITY_PX_MS;
      const farEnough = absX >= COMPLETE_DISTANCE_PX;
      const shouldNavigate =
        gesture.axis === "horizontal" &&
        Boolean(gesture.target) &&
        Boolean(gesture.direction) &&
        (farEnough || fastEnough);
      const target = gesture.target;
      const direction = gesture.direction;

      gestureRef.current = emptyGesture();

      if (shouldNavigate && target && direction) {
        navigateTo(target, direction);
      } else {
        hidePreview();
      }
    };

    const cancelGesture = () => {
      gestureRef.current = emptyGesture();
      hidePreview();
    };

    document.addEventListener("touchstart", onTouchStart, {
      passive: true,
      capture: true,
    });
    document.addEventListener("touchmove", onTouchMove, {
      passive: false,
      capture: true,
    });
    document.addEventListener("touchend", finishGesture, {
      passive: true,
      capture: true,
    });
    document.addEventListener("touchcancel", cancelGesture, {
      passive: true,
      capture: true,
    });
    return () => {
      document.removeEventListener("touchstart", onTouchStart, true);
      document.removeEventListener("touchmove", onTouchMove, true);
      document.removeEventListener("touchend", finishGesture, true);
      document.removeEventListener("touchcancel", cancelGesture, true);
      if (resetTimerRef.current) {
        window.clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }

      hidePreview(true);
    };
  }, [currentKey, pathname, router, searchKey]);

  return (
    <div
      ref={overlayRef}
      aria-hidden="true"
      className="bb-mobile-category-swipe bb-mobile-category-swipe--pro"
      data-enabled="true"
      data-visible="false"
      data-committed="false"
      data-dragging="false"
      data-direction="next"
      data-category="burger"
      data-style="edge-glow"
      data-theme="classic"
      data-label-enabled="true"
      data-instant="false"
      data-video-ready="false"
    >
      <div className="bb-mobile-category-swipe-real__scene">
        <div className="bb-mobile-category-swipe-real__fallback" />

        <video
          ref={videoRef}
          className="bb-mobile-category-swipe-real__video"
          muted
          loop
          playsInline
          preload="none"
          aria-hidden="true"
          onLoadedData={() => {
            if (overlayRef.current) {
              overlayRef.current.dataset.videoReady = "true";
            }
          }}
          onCanPlay={() => {
            if (overlayRef.current) {
              overlayRef.current.dataset.videoReady = "true";
            }
          }}
          onWaiting={() => {
            if (overlayRef.current) {
              overlayRef.current.dataset.videoReady = "false";
            }
          }}
          onError={() => {
            if (overlayRef.current) {
              overlayRef.current.dataset.videoReady = "false";
            }
          }}
        />

        <div className="bb-mobile-category-swipe-real__grade" />
      </div>

      <span
        ref={labelRef}
        className="bb-mobile-category-swipe-real__label"
      />

      <svg
        className="bb-mobile-category-swipe-real__edge-lines"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          ref={edgeGlowRef}
          className="bb-mobile-category-swipe-real__edge-glow"
        />
        <path
          ref={edgeCoreRef}
          className="bb-mobile-category-swipe-real__edge-core"
        />
      </svg>
    </div>
  );
}
