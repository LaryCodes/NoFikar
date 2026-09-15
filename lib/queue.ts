import {
  STORE_EVENTS,
  STORE_LOCATIONS,
  STORE_META,
  idbCountByIndex,
  idbDeleteMany,
  idbGet,
  idbGetAll,
  idbGetByIndex,
  idbPut,
  idbPutMany,
  idbSupported,
} from "@/lib/idb";
import type { AlertType } from "@/lib/alerts";

/**
 * The durable offline queue.
 *
 * GPS does not need the network, so a fix is written here FIRST and pushed to
 * Supabase afterwards. That inversion is what makes the app keep recording
 * through a tunnel, a dead cell, or a Supabase outage.
 *
 * Idempotency: `local_id` is generated at capture time and becomes the row's
 * primary key in Postgres. Replaying the queue therefore cannot create
 * duplicates, because the upsert is ON CONFLICT DO NOTHING on that id.
 */

export interface PendingLocation {
  local_id: string;
  user_id: string;
  family_id: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number;
  heading: number | null;
  altitude: number | null;
  battery_level: number | null;
  activity_status: string;
  /** When the fix was TAKEN, not when it was uploaded. Never rewritten. */
  recorded_at: string;
  captured_offline: 0 | 1;
  synced: 0 | 1;
  attempts: number;
  last_error: string | null;
}

/**
 * Safety events that must survive a dead connection. Deliberately not a
 * messaging system — only events the family relies on for safety.
 */
export type QueuedEventKind = "alert" | "sos_start" | "sos_close" | "sos_ack";

export interface PendingEvent {
  local_id: string;
  user_id: string;
  family_id: string;
  kind: QueuedEventKind;
  payload: Record<string, unknown>;
  recorded_at: string;
  captured_offline: 0 | 1;
  synced: 0 | 1;
  attempts: number;
  last_error: string | null;
}

export interface QueuedAlertPayload {
  type: AlertType;
  title: string;
  message?: string | null;
  data?: Record<string, unknown> | null;
}

/** Local geofence memory, so boundary crossings are detected while offline. */
export interface ZoneStateRecord {
  key: "zone_states";
  states: Record<string, boolean>;
}

export interface QueueStatus {
  pendingLocations: number;
  pendingEvents: number;
  syncing: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
}

// ---------------------------------------------------------------------------
// In-memory fallback. Private browsing and blocked storage must not stop the
// app from recording; the trade-off (points lost on refresh) is unavoidable
// there, and the UI does not claim otherwise.
// ---------------------------------------------------------------------------
const usingMemory = () => !idbSupported();
const memoryLocations = new Map<string, PendingLocation>();
const memoryEvents = new Map<string, PendingEvent>();
let memoryZoneStates: Record<string, boolean> = {};

export function newLocalId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // RFC-4122-shaped fallback for older WebViews. Only needs to be unique
  // enough to act as a primary key.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ---------------------------------------------------------------------------
// Status pub/sub
// ---------------------------------------------------------------------------
let status: QueueStatus = {
  pendingLocations: 0,
  pendingEvents: 0,
  syncing: false,
  lastSyncAt: null,
  lastError: null,
};

const listeners = new Set<(s: QueueStatus) => void>();

export function getQueueStatus(): QueueStatus {
  return status;
}

export function subscribeQueue(listener: (s: QueueStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(patch: Partial<QueueStatus>) {
  status = { ...status, ...patch };
  for (const listener of listeners) listener(status);
}

export function setSyncing(syncing: boolean) {
  emit({ syncing });
}

export function setSyncResult(error: string | null) {
  emit({
    syncing: false,
    lastError: error,
    lastSyncAt: error ? status.lastSyncAt : new Date().toISOString(),
  });
}

export async function refreshQueueCounts(): Promise<QueueStatus> {
  if (usingMemory()) {
    emit({
      pendingLocations: [...memoryLocations.values()].filter((l) => !l.synced)
        .length,
      pendingEvents: [...memoryEvents.values()].filter((e) => !e.synced).length,
    });
    return status;
  }

  const [pendingLocations, pendingEvents] = await Promise.all([
    idbCountByIndex(STORE_LOCATIONS, "synced", 0),
    idbCountByIndex(STORE_EVENTS, "synced", 0),
  ]);

  emit({ pendingLocations, pendingEvents });
  return status;
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------
export interface LocationCapture {
  userId: string;
  familyId: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number;
  heading: number | null;
  altitude: number | null;
  batteryLevel: number | null;
  activityStatus: string;
  recordedAt: string;
  offline: boolean;
}

export async function enqueueLocation(
  capture: LocationCapture
): Promise<PendingLocation> {
  const record: PendingLocation = {
    local_id: newLocalId(),
    user_id: capture.userId,
    family_id: capture.familyId,
    latitude: capture.latitude,
    longitude: capture.longitude,
    accuracy: capture.accuracy,
    speed: capture.speed,
    heading: capture.heading,
    altitude: capture.altitude,
    battery_level: capture.batteryLevel,
    activity_status: capture.activityStatus,
    recorded_at: capture.recordedAt,
    captured_offline: capture.offline ? 1 : 0,
    synced: 0,
    attempts: 0,
    last_error: null,
  };

  if (usingMemory()) memoryLocations.set(record.local_id, record);
  else await idbPut(STORE_LOCATIONS, record);

  await refreshQueueCounts();
  return record;
}

/** Oldest first: replaying in capture order keeps the route chronological. */
export async function getUnsyncedLocations(
  limit = 200
): Promise<PendingLocation[]> {
  const rows = usingMemory()
    ? [...memoryLocations.values()].filter((l) => !l.synced)
    : await idbGetByIndex<PendingLocation>(STORE_LOCATIONS, "synced", 0);

  return rows
    .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))
    .slice(0, limit);
}

export async function markLocationsSynced(records: PendingLocation[]) {
  if (records.length === 0) return;
  const updated = records.map((r) => ({ ...r, synced: 1 as const, last_error: null }));

  if (usingMemory()) {
    for (const r of updated) memoryLocations.set(r.local_id, r);
  } else {
    await idbPutMany(STORE_LOCATIONS, updated);
  }
  await refreshQueueCounts();
}

export async function markLocationsFailed(
  records: PendingLocation[],
  message: string
) {
  if (records.length === 0) return;
  const updated = records.map((r) => ({
    ...r,
    attempts: r.attempts + 1,
    last_error: message,
  }));

  if (usingMemory()) {
    for (const r of updated) memoryLocations.set(r.local_id, r);
  } else {
    await idbPutMany(STORE_LOCATIONS, updated);
  }
  await refreshQueueCounts();
}

/**
 * Every locally-known point for a user since `sinceIso`, synced or not.
 * This is what lets the device draw its own route while still offline.
 */
export async function getLocalTrack(
  userId: string,
  sinceIso: string
): Promise<PendingLocation[]> {
  const rows = usingMemory()
    ? [...memoryLocations.values()]
    : await idbGetAll<PendingLocation>(STORE_LOCATIONS);

  return rows
    .filter((r) => r.user_id === userId && r.recorded_at >= sinceIso)
    .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
export async function enqueueEvent(params: {
  userId: string;
  familyId: string;
  kind: QueuedEventKind;
  payload: Record<string, unknown>;
  recordedAt?: string;
  offline?: boolean;
}): Promise<PendingEvent> {
  const record: PendingEvent = {
    local_id: newLocalId(),
    user_id: params.userId,
    family_id: params.familyId,
    kind: params.kind,
    payload: params.payload,
    recorded_at: params.recordedAt ?? new Date().toISOString(),
    captured_offline: params.offline ? 1 : 0,
    synced: 0,
    attempts: 0,
    last_error: null,
  };

  if (usingMemory()) memoryEvents.set(record.local_id, record);
  else await idbPut(STORE_EVENTS, record);

  await refreshQueueCounts();
  return record;
}

export async function getUnsyncedEvents(limit = 100): Promise<PendingEvent[]> {
  const rows = usingMemory()
    ? [...memoryEvents.values()].filter((e) => !e.synced)
    : await idbGetByIndex<PendingEvent>(STORE_EVENTS, "synced", 0);

  return rows
    .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))
    .slice(0, limit);
}

export async function markEventSynced(record: PendingEvent) {
  const updated = { ...record, synced: 1 as const, last_error: null };
  if (usingMemory()) memoryEvents.set(updated.local_id, updated);
  else await idbPut(STORE_EVENTS, updated);
  await refreshQueueCounts();
}

export async function markEventFailed(record: PendingEvent, message: string) {
  const updated = {
    ...record,
    attempts: record.attempts + 1,
    last_error: message,
  };
  if (usingMemory()) memoryEvents.set(updated.local_id, updated);
  else await idbPut(STORE_EVENTS, updated);
  await refreshQueueCounts();
}

// ---------------------------------------------------------------------------
// Geofence state (survives reload, works offline)
// ---------------------------------------------------------------------------
export async function getZoneStates(): Promise<Record<string, boolean>> {
  if (usingMemory()) return memoryZoneStates;
  const record = await idbGet<ZoneStateRecord>(STORE_META, "zone_states");
  return record?.states ?? {};
}

export async function setZoneStates(states: Record<string, boolean>) {
  if (usingMemory()) {
    memoryZoneStates = states;
    return;
  }
  await idbPut<ZoneStateRecord>(STORE_META, { key: "zone_states", states });
}

// ---------------------------------------------------------------------------
// Last known fix
// ---------------------------------------------------------------------------
export interface StoredFix {
  user_id: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number;
  activity_status: string;
  battery_level: number | null;
  recorded_at: string;
  captured_offline: boolean;
}

interface LastFixRecord {
  key: "last_fix";
  fix: StoredFix;
}

let memoryLastFix: StoredFix | null = null;

/**
 * Persisted separately from the queue so an SOS can still attach a position
 * after a reload, or when the GPS cannot get a fresh fix indoors. Always
 * surfaced to the family as "last known", never as live.
 */
export async function setLastKnownFix(fix: StoredFix) {
  if (usingMemory()) {
    memoryLastFix = fix;
    return;
  }
  await idbPut<LastFixRecord>(STORE_META, { key: "last_fix", fix });
}

export async function getLastKnownFix(
  userId: string
): Promise<StoredFix | null> {
  if (usingMemory()) {
    return memoryLastFix?.user_id === userId ? memoryLastFix : null;
  }
  const record = await idbGet<LastFixRecord>(STORE_META, "last_fix");
  if (!record?.fix || record.fix.user_id !== userId) return null;
  return record.fix;
}

// ---------------------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------------------
/**
 * Synced points are kept for a while so the device can render its own recent
 * route without a round trip, then dropped. Without this the store would grow
 * without bound on a phone that shares location daily.
 */
export async function pruneSynced(retentionMs = 24 * 60 * 60 * 1000) {
  const cutoff = new Date(Date.now() - retentionMs).toISOString();

  if (usingMemory()) {
    for (const [id, r] of memoryLocations) {
      if (r.synced === 1 && r.recorded_at < cutoff) memoryLocations.delete(id);
    }
    for (const [id, r] of memoryEvents) {
      if (r.synced === 1 && r.recorded_at < cutoff) memoryEvents.delete(id);
    }
    return;
  }

  const [locations, events] = await Promise.all([
    idbGetByIndex<PendingLocation>(STORE_LOCATIONS, "synced", 1),
    idbGetByIndex<PendingEvent>(STORE_EVENTS, "synced", 1),
  ]);

  const staleLocations = locations
    .filter((r) => r.recorded_at < cutoff)
    .map((r) => r.local_id);
  const staleEvents = events
    .filter((r) => r.recorded_at < cutoff)
    .map((r) => r.local_id);

  await Promise.all([
    idbDeleteMany(STORE_LOCATIONS, staleLocations),
    idbDeleteMany(STORE_EVENTS, staleEvents),
  ]);
}

/** Called on sign-out: another account must not inherit this queue. */
export async function clearQueue() {
  if (usingMemory()) {
    memoryLocations.clear();
    memoryEvents.clear();
    memoryZoneStates = {};
    memoryLastFix = null;
  } else {
    const [locations, events] = await Promise.all([
      idbGetAll<PendingLocation>(STORE_LOCATIONS),
      idbGetAll<PendingEvent>(STORE_EVENTS),
    ]);
    await Promise.all([
      idbDeleteMany(
        STORE_LOCATIONS,
        locations.map((r) => r.local_id)
      ),
      idbDeleteMany(
        STORE_EVENTS,
        events.map((r) => r.local_id)
      ),
      setZoneStates({}),
    ]);
  }
  await refreshQueueCounts();
}
