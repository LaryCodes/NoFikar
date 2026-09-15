"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Tracks connectivity. Starts optimistic (true) so server render and first
 * client paint agree — reading navigator.onLine during render would cause a
 * hydration mismatch.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);

    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  return online;
}

const PULL_THRESHOLD = 70;

/**
 * Pull-to-refresh for a scrollable container.
 *
 * Only engages when the container is already scrolled to the top, so it never
 * fights normal scrolling. Returns the props to spread plus the live pull
 * distance for rendering an indicator.
 */
export function usePullToRefresh(onRefresh: () => Promise<void> | void) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const el = containerRef.current;
    if (!el || el.scrollTop > 0 || refreshing) return;
    startY.current = e.touches[0].clientY;
  }, [refreshing]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (startY.current == null) return;
    const delta = e.touches[0].clientY - startY.current;
    if (delta <= 0) {
      setPull(0);
      return;
    }
    // Dampen so the gesture feels resistive rather than 1:1.
    setPull(Math.min(delta * 0.5, PULL_THRESHOLD * 1.5));
  }, []);

  const onTouchEnd = useCallback(async () => {
    if (startY.current == null) return;
    startY.current = null;

    if (pull >= PULL_THRESHOLD && !refreshing) {
      setRefreshing(true);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
      }
    }
    setPull(0);
  }, [pull, refreshing, onRefresh]);

  return {
    containerRef,
    pull,
    refreshing,
    isArmed: pull >= PULL_THRESHOLD,
    handlers: { onTouchStart, onTouchMove, onTouchEnd },
  };
}
