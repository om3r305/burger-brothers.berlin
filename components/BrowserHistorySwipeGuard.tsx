"use client";

import { useEffect } from "react";
import { installBrowserHistorySwipeGuard } from "@/lib/client/browser-history-swipe";

export default function BrowserHistorySwipeGuard() {
  useEffect(() => installBrowserHistorySwipeGuard(), []);
  return null;
}
