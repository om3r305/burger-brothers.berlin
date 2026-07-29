"use client";

type IOSNavigator = Navigator & { standalone?: boolean };

export const SAMSUNG_SAFE_INSTALL_MARKER =
  "bb_samsung_safe_home_shortcut_v1";
export const ADMIN_SAMSUNG_SAFE_INSTALL_MARKER =
  "bb_admin_samsung_safe_home_shortcut_v1";

export type PwaClientInfo = {
  isAndroid: boolean;
  isIOS: boolean;
  isSamsungInternet: boolean;
  isStandalone: boolean;
};

export class PwaStepTimeoutError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "PwaStepTimeoutError";
    this.code = code;
  }
}

export function isPwaStepTimeoutError(
  value: unknown,
): value is PwaStepTimeoutError {
  return value instanceof PwaStepTimeoutError;
}

export async function withPwaStepTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  code: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      reject(new PwaStepTimeoutError(code));
    }, Math.max(1_000, timeoutMs));
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) globalThis.clearTimeout(timeoutId);
  }
}

export function isIOSLikeDevice() {
  if (typeof window === "undefined") return false;
  const nav = navigator as IOSNavigator;
  const ua = nav.userAgent || "";

  return (
    /iphone|ipad|ipod/i.test(ua) ||
    (nav.platform === "MacIntel" && Number(nav.maxTouchPoints || 0) > 1)
  );
}

export function isSamsungInternetBrowser() {
  if (typeof window === "undefined") return false;
  return /SamsungBrowser\//i.test(navigator.userAgent || "");
}

export function isStandaloneDisplayMode() {
  if (typeof window === "undefined") return false;
  const nav = navigator as IOSNavigator;

  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    window.matchMedia?.("(display-mode: fullscreen)").matches === true ||
    nav.standalone === true
  );
}

export function detectPwaClient(): PwaClientInfo {
  if (typeof window === "undefined") {
    return {
      isAndroid: false,
      isIOS: false,
      isSamsungInternet: false,
      isStandalone: false,
    };
  }

  return {
    isAndroid: /android/i.test(navigator.userAgent || ""),
    isIOS: isIOSLikeDevice(),
    isSamsungInternet: isSamsungInternetBrowser(),
    isStandalone: isStandaloneDisplayMode(),
  };
}

function writeMarker(key: string) {
  try {
    localStorage.setItem(key, String(Date.now()));
  } catch {}
}

function readMarker(key: string) {
  try {
    return Boolean(localStorage.getItem(key));
  } catch {
    return false;
  }
}

export function markSamsungSafeInstallIntent() {
  writeMarker(SAMSUNG_SAFE_INSTALL_MARKER);
}

export function hasSamsungSafeInstallIntent() {
  return readMarker(SAMSUNG_SAFE_INSTALL_MARKER);
}

export function markAdminSamsungSafeInstallIntent() {
  writeMarker(ADMIN_SAMSUNG_SAFE_INSTALL_MARKER);
}

export function hasAdminSamsungSafeInstallIntent() {
  return readMarker(ADMIN_SAMSUNG_SAFE_INSTALL_MARKER);
}
