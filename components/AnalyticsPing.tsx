"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

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

function getSessionId() {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;

    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function sendAnalytics(pathname: string) {
  try {
    const path =
      typeof window !== "undefined"
        ? `${pathname}${window.location.search || ""}`
        : pathname;

    const payload = JSON.stringify({
      event: "page_view",
      path,
      sessionId: getSessionId(),
      props: {
        pathname,
      },
    });

    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const blob = new Blob([payload], {
        type: "application/json",
      });

      const sent = navigator.sendBeacon(ENDPOINT, blob);
      if (sent) return;
    }

    fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: payload,
      cache: "no-store",
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Analytics darf die Seite niemals blockieren.
  }
}

export default function AnalyticsPing() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || shouldSkip(pathname)) return;
    sendAnalytics(pathname);
  }, [pathname]);

  return null;
}