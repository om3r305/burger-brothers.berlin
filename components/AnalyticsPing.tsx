"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { isCustomerAnalyticsPath } from "@/lib/reporting";

export const ANALYTICS_CONSENT_KEY = "bb_analytics_consent_v1";
export const ANALYTICS_CONSENT_EVENT = "bb:analytics-consent";
const ENDPOINT = "/api/analytics/collect";
const SESSION_KEY = "bb_analytics_session_id";

function shouldSkip(pathname: string) {
  return !isCustomerAnalyticsPath(pathname);
}

function hasConsent() {
  try {
    return localStorage.getItem(ANALYTICS_CONSENT_KEY) === "granted";
  } catch {
    return false;
  }
}

function getSessionId() {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return "";
  }
}

function sendAnalytics(pathname: string) {
  if (!hasConsent()) return;
  const payload = JSON.stringify({
    event: "page_view",
    path: pathname,
    sessionId: getSessionId(),
    consentVersion: "analytics-v1",
    props: { pathname, source:
      window.matchMedia?.("(display-mode: standalone)").matches ||
      window.matchMedia?.("(display-mode: fullscreen)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone ||
      document.referrer.startsWith("android-app://") ||
      !!(window as Window & { __BB_NATIVE_APP__?: unknown }).__BB_NATIVE_APP__ ? "app" : "web" },
  });

  fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: payload,
    cache: "no-store",
    keepalive: true,
  }).catch(() => undefined);
}

export default function AnalyticsPing() {
  const pathname = usePathname();
  const lastSent = useRef("");

  useEffect(() => {
    if (!pathname || shouldSkip(pathname)) { lastSent.current = ""; return; }
    const send = () => {
      if (!hasConsent()) { lastSent.current = ""; return; }
      if (lastSent.current === pathname) return;
      lastSent.current = pathname;
      sendAnalytics(pathname);
    };
    send();
    window.addEventListener(ANALYTICS_CONSENT_EVENT, send);
    return () => window.removeEventListener(ANALYTICS_CONSENT_EVENT, send);
  }, [pathname]);

  return null;
}
