"use client";

import { useEffect, useState } from "react";
import { fetchPause, type PauseState } from "@/lib/pause";

export function useTvPause() {
  const [pause, setPause] = useState<PauseState>({
    delivery: false,
    pickup: false,
  });

  useEffect(() => {
    let active = true;

    fetchPause()
      .then((state) => {
        if (active) setPause(state);
      })
      .catch(() => {
        // Mevcut güvenli default korunur.
      });

    return () => {
      active = false;
    };
  }, []);

  return { pause, setPause };
}
