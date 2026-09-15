"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, UploadCloud, Loader2, WifiOff } from "lucide-react";
import { useLocationSharing } from "@/lib/locationSharing";

/**
 * Connectivity and sync state, in one honest line.
 *
 * The old version only said "you're offline — updates will resume". That was
 * misleading in both directions: it implied nothing was being recorded, and it
 * gave no indication that a backlog existed once the network returned. Now it
 * reports what is actually happening to the data.
 */
export default function OfflineBanner() {
  const { online, sharing, pendingLocations, pendingEvents, syncing, syncNow } =
    useLocationSharing();

  const pending = pendingLocations + pendingEvents;
  const [hadBacklog, setHadBacklog] = useState(false);

  // Remember that a backlog existed, so its clearing can be confirmed rather
  // than the banner just vanishing and leaving the user unsure.
  useEffect(() => {
    if (pending > 0 || syncing) setHadBacklog(true);
  }, [pending, syncing]);

  useEffect(() => {
    if (!hadBacklog || pending > 0 || syncing || !online) return;
    const timer = setTimeout(() => setHadBacklog(false), 4000);
    return () => clearTimeout(timer);
  }, [hadBacklog, pending, syncing, online]);

  if (!online) {
    return (
      <div
        role="status"
        className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 bg-destructive px-4 py-2 text-center text-sm font-medium text-destructive-foreground"
      >
        <span className="flex items-center gap-2">
          <WifiOff className="h-4 w-4" aria-hidden="true" />
          {sharing ? "Offline — recording locally" : "You're offline"}
        </span>
        {pending > 0 && (
          <span className="text-xs opacity-90">
            {pending} {pending === 1 ? "point" : "points"} waiting to sync
          </span>
        )}
      </div>
    );
  }

  if (syncing && pending > 0) {
    return (
      <div
        role="status"
        className="flex items-center justify-center gap-2 bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Back online — syncing {pending} offline{" "}
        {pending === 1 ? "record" : "records"}…
      </div>
    );
  }

  if (pending > 0) {
    return (
      <button
        type="button"
        onClick={() => void syncNow()}
        className="flex w-full items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950"
      >
        <UploadCloud className="h-4 w-4" aria-hidden="true" />
        {pending} {pending === 1 ? "record" : "records"} waiting to sync — tap to
        retry
      </button>
    );
  }

  if (hadBacklog) {
    return (
      <div
        role="status"
        className="flex items-center justify-center gap-2 bg-primary/15 px-4 py-2 text-sm font-medium text-primary"
      >
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        All locations synced
      </div>
    );
  }

  return null;
}
