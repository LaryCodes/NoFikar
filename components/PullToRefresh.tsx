"use client";

import { Loader2, ArrowDown } from "lucide-react";
import { usePullToRefresh } from "@/lib/hooks";
import { cn } from "@/lib/utils";

interface PullToRefreshProps {
  onRefresh: () => Promise<void> | void;
  children: React.ReactNode;
  className?: string;
}

/**
 * Scrollable container with native-feeling pull-to-refresh.
 * Touch-only by design; desktop users get the standard browser reload.
 */
export default function PullToRefresh({
  onRefresh,
  children,
  className,
}: PullToRefreshProps) {
  const { containerRef, pull, refreshing, isArmed, handlers } =
    usePullToRefresh(onRefresh);

  return (
    <div
      ref={containerRef}
      {...handlers}
      className={cn("h-full overflow-y-auto overscroll-y-contain", className)}
    >
      <div
        className="flex items-center justify-center overflow-hidden transition-[height] duration-150"
        style={{ height: refreshing ? 44 : pull }}
        aria-live="polite"
      >
        {refreshing ? (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Refreshing
          </span>
        ) : pull > 0 ? (
          <ArrowDown
            className={cn(
              "h-5 w-5 text-muted-foreground transition-transform",
              isArmed && "rotate-180 text-primary"
            )}
          />
        ) : null}
      </div>

      {children}
    </div>
  );
}
