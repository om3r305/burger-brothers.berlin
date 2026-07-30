"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export const ANALYTICS_CONSENT_KEY = "bb_analytics_consent_v1";
export const ANALYTICS_CONSENT_EVENT = "bb:analytics-consent";
const ENDPOINT = "/api/analytics/collect";
const SESSION_KEY = "bb_analytics_session_id";

function shouldSkip(pathname: string) {
  if (!pathname) return true;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return true;
  if (pathname === "/tv" || pathname.startsWith("/tv/")) return true;
  if (pathname === "/api" || pathname.startsWith("/api/")) return true;
  if (pathname.startsWith("/_next/")) return true;
  return false;
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
    props: { pathname },
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

  useEffect(() => {
    if (!pathname || shouldSkip(pathname)) return;
    const send = () => sendAnalytics(pathname);
    send();
    window.addEventListener(ANALYTICS_CONSENT_EVENT, send);
    return () => window.removeEventListener(ANALYTICS_CONSENT_EVENT, send);
  }, [pathname]);

  return null;
}
