"use client";

import { useCallback, useRef, useState } from "react";
import {
  PULL_REFRESH_MAX_PX,
  PULL_REFRESH_TRIGGER_PX,
} from "@/lib/driver/domain";

export function usePullToRefresh({
  disabled,
  onRefresh,
}: {
  disabled: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [pullDistance, setPullDistance] = useState(0);
  const [pullRefreshing, setPullRefreshing] = useState(false);

  const pullStartYRef = useRef<number | null>(null);
  const pullActiveRef = useRef(false);

  const pullRefresh = useCallback(async () => {
    if (pullRefreshing || disabled) return;

    setPullRefreshing(true);

    try {
      await onRefresh();
    } finally {
      setPullRefreshing(false);
      setPullDistance(0);
      pullStartYRef.current = null;
      pullActiveRef.current = false;
    }
  }, [disabled, onRefresh, pullRefreshing]);

  const onPullStart = useCallback(
    (event: React.TouchEvent<HTMLElement>) => {
      if (window.scrollY > 0 || disabled || pullRefreshing) return;

      pullStartYRef.current = event.touches[0]?.clientY ?? null;
      pullActiveRef.current = true;
    },
    [disabled, pullRefreshing],
  );

  const onPullMove = useCallback(
    (event: React.TouchEvent<HTMLElement>) => {
      if (!pullActiveRef.current || pullStartYRef.current == null) return;

      if (window.scrollY > 0) {
        setPullDistance(0);
        pullActiveRef.current = false;
        pullStartYRef.current = null;
        return;
      }

      const currentY = event.touches[0]?.clientY ?? 0;
      const difference = currentY - pullStartYRef.current;

      if (difference <= 0) {
        setPullDistance(0);
        return;
      }

      setPullDistance(
        Math.min(PULL_REFRESH_MAX_PX, Math.round(difference * 0.55)),
      );
    },
    [],
  );

  const onPullEnd = useCallback(() => {
    if (!pullActiveRef.current) return;

    const shouldRefresh =
      pullDistance >= PULL_REFRESH_TRIGGER_PX;

    pullActiveRef.current = false;
    pullStartYRef.current = null;

    if (shouldRefresh) {
      void pullRefresh();
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, pullRefresh]);

  return {
    pullDistance,
    pullRefreshing,
    pullReady: pullDistance >= PULL_REFRESH_TRIGGER_PX,
    pullVisible: pullDistance > 8 || pullRefreshing,
    onPullStart,
    onPullMove,
    onPullEnd,
  };
}
