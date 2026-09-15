"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  getQueueStatus,
  getUnsyncedEvents,
  getUnsyncedLocations,
  markEventFailed,
  markEventSynced,
  markLocationsFailed,
  markLocationsSynced,
  pruneSynced,
  refreshQueueCounts,
  setSyncResult,
  setSyncing,
  subscribeQueue,
  type PendingEvent,
  type PendingLocation,
  type QueuedAlertPayload,
  type QueueStatus,
} from "@/lib/queue";

/**
 * Drains the offline queue into Supabase.
 *
 * Guarantees it actually provides:
 *   * Original capture timestamps are preserved (`created_at` = recorded_at).
 *   * Original ordering is preserved (oldest first, events strictly serial).
 *   * No duplicates, because `id` is the client-generated local_id and the
 *     write is ON CONFLICT DO NOTHING.
 *   * A failed batch does not lose points: they stay unsynced with an attempt
 *     count and are retried on the next trigger.
 *   * Batched writes, so a 40-minute offline trip is a handful of requests
 *     rather than hundreds.
 */

/** Rows per request. Large enough to be cheap, small enough to retry fast. */
const LOCATION_BATCH = 50;
/** After this many failures a record is parked so it cannot block the queue. */
const MAX_ATTEMPTS = 8;
/** Hard cap on batches per run, so a huge backlog cannot lock the main thread. */
const MAX_BATCHES_PER_RUN = 40;

const SYNC_INTERVAL_MS = 30_000;

/** Pruning scans the synced index, so it is not worth doing on every trigger. */
const PRUNE_INTERVAL_MS = 10 * 60_000;

let running = false;
let lastPruneAt = 0;

async function maybePrune(): Promise<void> {
  if (Date.now() - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = Date.now();
  await pruneSynced();
}

function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

function toLocationRow(record: PendingLocation) {
  return {
    // Client-generated primary key: this is what makes replay idempotent.
    id: record.local_id,
    user_id: record.user_id,
    family_id: record.family_id,
    latitude: record.latitude,
    longitude: record.longitude,
    speed: record.speed,
    accuracy: record.accuracy,
    activity_status: record.activity_status,
    battery_level: record.battery_level,
    heading: record.heading,
    altitude: record.altitude,
    captured_offline: record.captured_offline === 1,
    // The moment the fix was taken, never the moment it was uploaded.
    created_at: record.recorded_at,
    synced_at: new Date().toISOString(),
  };
}

async function syncLocations(): Promise<void> {
  for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
    const pending = await getUnsyncedLocations(LOCATION_BATCH);
    if (pending.length === 0) return;

    const eligible = pending.filter((r) => r.attempts < MAX_ATTEMPTS);
    // Everything left has exhausted its retries: stop rather than spin.
    if (eligible.length === 0) return;

    const { error } = await supabase
      .from("location_history")
      .upsert(eligible.map(toLocationRow), {
        onConflict: "id",
        ignoreDuplicates: true,
      });

    if (error) {
      await markLocationsFailed(eligible, error.message);
      throw new Error(error.message);
    }

    await markLocationsSynced(eligible);
    if (pending.length < LOCATION_BATCH) return;
  }
}

async function deliverEvent(event: PendingEvent): Promise<void> {
  if (event.kind === "alert") {
    const payload = event.payload as unknown as QueuedAlertPayload;
    const { error } = await supabase.from("alerts").upsert(
      {
        id: event.local_id,
        family_id: event.family_id,
        user_id: event.user_id,
        type: payload.type,
        title: payload.title,
        message: payload.message ?? null,
        data: payload.data
          ? { ...payload.data, at: event.recorded_at }
          : { at: event.recorded_at },
        created_at: event.recorded_at,
      },
      { onConflict: "id", ignoreDuplicates: true }
    );
    if (error) throw new Error(error.message);
    return;
  }

  if (event.kind === "sos_start") {
    const payload = event.payload as {
      session_id: string;
      data: Record<string, unknown>;
    };
    const { error } = await supabase.from("emergency_sessions").upsert(
      {
        id: payload.session_id,
        family_id: event.family_id,
        requester_id: event.user_id,
        // An SOS addresses the whole family, so it targets itself.
        target_id: event.user_id,
        session_type: "sos",
        status: "active",
        approved_at: event.recorded_at,
        created_at: event.recorded_at,
        data: payload.data,
      },
      { onConflict: "id", ignoreDuplicates: true }
    );
    if (error) throw new Error(error.message);
    return;
  }

  if (event.kind === "sos_close") {
    const payload = event.payload as {
      session_id: string;
      status: "resolved" | "ended";
    };
    const { error } = await supabase
      .from("emergency_sessions")
      .update({ status: payload.status, ended_at: event.recorded_at })
      .eq("id", payload.session_id);
    if (error) throw new Error(error.message);
    return;
  }

  if (event.kind === "sos_ack") {
    const payload = event.payload as { session_id: string };
    const { error } = await supabase
      .from("emergency_sessions")
      .update({
        acknowledged_by: event.user_id,
        acknowledged_at: event.recorded_at,
      })
      .eq("id", payload.session_id);
    if (error) throw new Error(error.message);
  }
}

async function syncEvents(): Promise<void> {
  const events = await getUnsyncedEvents();

  // Strictly serial: an sos_close must never be applied before its sos_start,
  // so the first failure stops the run and everything after it waits.
  for (const event of events) {
    if (event.attempts >= MAX_ATTEMPTS) continue;

    try {
      await deliverEvent(event);
      await markEventSynced(event);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Event sync failed";
      await markEventFailed(event, message);
      throw new Error(message);
    }
  }
}

/**
 * Drains the queue. Safe to call from many triggers at once: concurrent calls
 * return immediately rather than racing each other into duplicate work.
 */
export async function runSync(): Promise<void> {
  if (running) return;
  if (!isOnline()) return;

  const snapshot = await refreshQueueCounts();
  if (snapshot.pendingLocations === 0 && snapshot.pendingEvents === 0) {
    await maybePrune();
    return;
  }

  running = true;
  setSyncing(true);

  try {
    await syncLocations();
    await syncEvents();
    setSyncResult(null);
    await maybePrune();
  } catch (err) {
    setSyncResult(err instanceof Error ? err.message : "Sync failed");
  } finally {
    running = false;
  }
}

export function useQueueStatus(): QueueStatus {
  const [state, setState] = useState<QueueStatus>(getQueueStatus);

  useEffect(() => {
    const unsubscribe = subscribeQueue(setState);
    void refreshQueueCounts();
    return unsubscribe;
  }, []);

  return state;
}

/**
 * Installs the sync triggers. Mounted once, from the location-sharing provider.
 *
 * There is deliberately no Service Worker Background Sync here. Replaying the
 * queue needs the user's Supabase session, and a worker woken with no client
 * has no reliable access to it — wiring that up would produce a feature that
 * looks real and silently does nothing. Instead the queue is drained the moment
 * the app is in front of the user or the network returns, which is honest and
 * actually works. See the PWA limitation notes in lib/queue.ts.
 */
export function useSyncEngine(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    void runSync();

    const onOnline = () => {
      void runSync();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void runSync();
    };

    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);

    // Catches the case where the browser never fires `online` (common on
    // desktop when a captive portal drops), and any parked retries.
    const interval = setInterval(() => {
      void runSync();
    }, SYNC_INTERVAL_MS);

    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
    };
  }, [enabled]);
}
