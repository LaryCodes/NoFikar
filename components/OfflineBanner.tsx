"use client";

import { WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/lib/hooks";

/**
 * Persistent notice while the device is offline. Location writes and realtime
 * updates will not reach Supabase in this state, so it is worth being explicit
 * rather than letting the UI look silently stale.
 */
export default function OfflineBanner() {
  const online = useOnlineStatus();

  if (online) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground"
    >
      <WifiOff className="h-4 w-4" aria-hidden="true" />
      You&apos;re offline — updates will resume when you reconnect
    </div>
  );
}
