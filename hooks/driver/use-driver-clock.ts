"use client";

import { useEffect, useState } from "react";

export function useDriverClock(intervalMs = 30_000) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = window.setInterval(
      () => setNowMs(Date.now()),
      intervalMs,
    );

    return () => window.clearInterval(intervalId);
  }, [intervalMs]);

  return nowMs;
}
