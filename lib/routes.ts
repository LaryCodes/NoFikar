import { getDistanceInMeters } from "@/lib/locationUtils";
import type { SafeZone } from "@/types";

/**
 * Turns recorded GPS points into a route and a human timeline.
 *
 * Everything here is derived from points that were actually recorded. No
 * position is interpolated, no place is invented: the only names used are the
 * family's own safe zones, and a gap in the data is reported as a gap rather
 * than smoothed over with a straight line pretending to be a journey.
 */

export interface RoutePoint {
  /** Row id, which for queued points is the client-generated local_id. */
  id: string;
  lat: number;
  lng: number;
  at: string;
  speed: number;
  accuracy: number;
  battery: number | null;
  activity: string;
  capturedOffline: boolean;
}

/** A contiguous run drawn as one polyline. Offline runs are styled apart. */
export interface RouteSegment {
  points: Array<{ lat: number; lng: number }>;
  offline: boolean;
}

export type TimelineKind =
  | "start"
  | "stop"
  | "zone_enter"
  | "zone_exit"
  | "offline"
  | "gap"
  | "latest";

export interface TimelineEntry {
  id: string;
  kind: TimelineKind;
  at: string;
  endAt?: string;
  label: string;
  detail?: string;
  lat?: number;
  lng?: number;
  durationMs?: number;
}

export interface RouteSummary {
  points: number;
  offlinePoints: number;
  distanceM: number;
  durationMs: number;
  movingMs: number;
  stationaryMs: number;
  offlineMs: number;
  startAt: string | null;
  endAt: string | null;
}

export interface RouteAnalysis {
  points: RoutePoint[];
  segments: RouteSegment[];
  timeline: TimelineEntry[];
  summary: RouteSummary;
}

/** Below this a position change is indistinguishable from GPS noise. */
const NOISE_FLOOR_M = 12;
/** Stationary threshold, matching getActivityStatus's "Stationary" band. */
const MOVING_SPEED_KMH = 2;
/** A pause shorter than this is not interesting enough to list. */
const MIN_STOP_MS = 3 * 60_000;
/** Movement allowed inside a "stop" before it counts as travel. */
const STOP_RADIUS_M = 60;
/** No points for longer than this is a break in the record, not a journey. */
const GAP_MS = 5 * 60_000;

export function meaningfulDistance(
  a: RoutePoint,
  b: RoutePoint
): number {
  const distance = getDistanceInMeters(a.lat, a.lng, b.lat, b.lng);
  // Two fixes 8m apart with ±30m accuracy have not demonstrably moved.
  const threshold = Math.max(NOISE_FLOOR_M, a.accuracy * 0.5, b.accuracy * 0.5);
  return distance >= threshold ? distance : 0;
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 1) return "under a minute";
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`;
}

export function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(metres < 10_000 ? 1 : 0)} km`;
}

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function zoneContaining(
  point: RoutePoint,
  zones: SafeZone[]
): SafeZone | null {
  for (const zone of zones) {
    if (
      getDistanceInMeters(point.lat, point.lng, zone.latitude, zone.longitude) <=
      zone.radius
    ) {
      return zone;
    }
  }
  return null;
}

/**
 * Caps how many vertices reach Leaflet. A day of tracking can be thousands of
 * points, and drawing all of them costs far more than it shows. Endpoints are
 * always preserved so the line still starts and finishes in the right place.
 */
export function simplifyPath<T>(points: T[], maxPoints = 300): T[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  const out: T[] = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function buildSegments(points: RoutePoint[]): RouteSegment[] {
  const segments: RouteSegment[] = [];
  let current: RouteSegment | null = null;

  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const previous = i > 0 ? points[i - 1] : null;

    // Break the line across a recording gap rather than drawing a straight
    // line the person never travelled.
    const brokeGap =
      previous != null &&
      new Date(point.at).getTime() - new Date(previous.at).getTime() > GAP_MS;

    if (!current || current.offline !== point.capturedOffline || brokeGap) {
      // Bridge one vertex so consecutive segments visually connect.
      if (current && !brokeGap && previous) {
        current.points.push({ lat: point.lat, lng: point.lng });
      }
      current = { points: [], offline: point.capturedOffline };
      segments.push(current);
    }

    current.points.push({ lat: point.lat, lng: point.lng });
  }

  return segments.filter((s) => s.points.length >= 2);
}

function buildTimeline(
  points: RoutePoint[],
  zones: SafeZone[]
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  if (points.length === 0) return entries;

  const first = points[0];
  const firstZone = zoneContaining(first, zones);
  entries.push({
    id: `start-${first.at}`,
    kind: "start",
    at: first.at,
    label: firstZone ? `Tracking started at ${firstZone.name}` : "Tracking started",
    lat: first.lat,
    lng: first.lng,
  });

  // Zone membership needs two consecutive points inside before it counts, so a
  // single stray fix cannot manufacture an arrival.
  let currentZone: SafeZone | null = firstZone;
  let candidateZoneId: string | null = null;
  let candidateSince: RoutePoint | null = null;

  let stopAnchor: RoutePoint | null = null;
  let offlineRunStart: RoutePoint | null = null;

  for (let i = 1; i < points.length; i++) {
    const point = points[i];
    const previous = points[i - 1];
    const dt = new Date(point.at).getTime() - new Date(previous.at).getTime();

    // --- recording gaps ---------------------------------------------------
    if (dt > GAP_MS) {
      entries.push({
        id: `gap-${previous.at}`,
        kind: point.capturedOffline ? "offline" : "gap",
        at: previous.at,
        endAt: point.at,
        durationMs: dt,
        label: point.capturedOffline
          ? `Offline for ${formatDuration(dt)}`
          : `No recording for ${formatDuration(dt)}`,
        detail: point.capturedOffline
          ? "Positions were still recorded on the device and synced later."
          : "The app was closed or suspended, so no positions were recorded.",
        lat: previous.lat,
        lng: previous.lng,
      });
      stopAnchor = null;
    }

    // --- offline runs -----------------------------------------------------
    if (point.capturedOffline && !offlineRunStart) {
      offlineRunStart = point;
    } else if (!point.capturedOffline && offlineRunStart) {
      const runMs =
        new Date(previous.at).getTime() - new Date(offlineRunStart.at).getTime();
      if (runMs >= 60_000) {
        entries.push({
          id: `offline-${offlineRunStart.at}`,
          kind: "offline",
          at: offlineRunStart.at,
          endAt: previous.at,
          durationMs: runMs,
          label: `Offline route recovered — ${formatDuration(runMs)}`,
          detail: "Recorded on the device with no connection, then synced.",
          lat: offlineRunStart.lat,
          lng: offlineRunStart.lng,
        });
      }
      offlineRunStart = null;
    }

    // --- safe zones -------------------------------------------------------
    const zoneHere = zoneContaining(point, zones);
    const zoneHereId: string | null = zoneHere ? zoneHere.id : null;
    const currentZoneId: string | null = currentZone ? currentZone.id : null;

    if (zoneHereId !== currentZoneId) {
      // Confirmed only when a second consecutive fix agrees, so one stray
      // position cannot manufacture an arrival or a departure.
      if (zoneHereId === candidateZoneId && candidateSince) {
        if (currentZone) {
          entries.push({
            id: `exit-${currentZone.id}-${candidateSince.at}`,
            kind: "zone_exit",
            at: candidateSince.at,
            label: `Left ${currentZone.name}`,
            lat: candidateSince.lat,
            lng: candidateSince.lng,
          });
        }
        if (zoneHere) {
          entries.push({
            id: `enter-${zoneHere.id}-${candidateSince.at}`,
            kind: "zone_enter",
            at: candidateSince.at,
            label: `Arrived at ${zoneHere.name}`,
            lat: candidateSince.lat,
            lng: candidateSince.lng,
          });
        }
        currentZone = zoneHere;
        candidateZoneId = null;
        candidateSince = null;
      } else {
        candidateZoneId = zoneHereId;
        candidateSince = point;
      }
    } else {
      candidateZoneId = null;
      candidateSince = null;
    }

    // --- stops ------------------------------------------------------------
    const moved = meaningfulDistance(previous, point);
    const isMoving = point.speed >= MOVING_SPEED_KMH || moved > 0;

    if (!isMoving) {
      if (!stopAnchor) stopAnchor = previous;
    } else if (stopAnchor) {
      const stopMs =
        new Date(previous.at).getTime() - new Date(stopAnchor.at).getTime();
      const drift = getDistanceInMeters(
        stopAnchor.lat,
        stopAnchor.lng,
        previous.lat,
        previous.lng
      );
      if (stopMs >= MIN_STOP_MS && drift <= STOP_RADIUS_M) {
        const zone = zoneContaining(stopAnchor, zones);
        entries.push({
          id: `stop-${stopAnchor.at}`,
          kind: "stop",
          at: stopAnchor.at,
          endAt: previous.at,
          durationMs: stopMs,
          label: zone
            ? `Stopped at ${zone.name} — ${formatDuration(stopMs)}`
            : `Stopped for ${formatDuration(stopMs)}`,
          lat: stopAnchor.lat,
          lng: stopAnchor.lng,
        });
      }
      stopAnchor = null;
    }
  }

  const last = points[points.length - 1];
  const lastZone = zoneContaining(last, zones);
  entries.push({
    id: `latest-${last.at}`,
    kind: "latest",
    at: last.at,
    label: lastZone ? `Last recorded at ${lastZone.name}` : "Last recorded position",
    detail: last.capturedOffline
      ? "Captured offline and synced afterwards."
      : undefined,
    lat: last.lat,
    lng: last.lng,
  });

  return entries.sort((a, b) => a.at.localeCompare(b.at));
}

export function analyseRoute(
  rawPoints: RoutePoint[],
  zones: SafeZone[] = []
): RouteAnalysis {
  const points = [...rawPoints].sort((a, b) => a.at.localeCompare(b.at));

  const summary: RouteSummary = {
    points: points.length,
    offlinePoints: points.filter((p) => p.capturedOffline).length,
    distanceM: 0,
    durationMs: 0,
    movingMs: 0,
    stationaryMs: 0,
    offlineMs: 0,
    startAt: points[0]?.at ?? null,
    endAt: points[points.length - 1]?.at ?? null,
  };

  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1];
    const point = points[i];
    const dt = new Date(point.at).getTime() - new Date(previous.at).getTime();
    if (dt <= 0) continue;

    const moved = meaningfulDistance(previous, point);
    summary.distanceM += moved;

    // A recording gap is neither moving nor stationary time — it is unknown,
    // so it is counted separately instead of being attributed to either.
    if (dt > GAP_MS) {
      if (point.capturedOffline) summary.offlineMs += dt;
      continue;
    }

    if (point.capturedOffline) summary.offlineMs += dt;
    if (moved > 0 || point.speed >= MOVING_SPEED_KMH) summary.movingMs += dt;
    else summary.stationaryMs += dt;
  }

  if (summary.startAt && summary.endAt) {
    summary.durationMs =
      new Date(summary.endAt).getTime() - new Date(summary.startAt).getTime();
  }

  return {
    points,
    segments: buildSegments(points),
    timeline: buildTimeline(points, zones),
    summary,
  };
}

export type RangeKey = "today" | "24h" | "7d";

export const RANGE_LABELS: Record<RangeKey, string> = {
  today: "Today",
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
};

export function rangeStart(range: RangeKey): Date {
  const now = new Date();
  if (range === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start;
  }
  if (range === "24h") return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
}
