import { getDistanceInMeters } from "@/lib/locationUtils";
import type { SafeZone } from "@/types";

/**
 * Geofencing is evaluated locally and synchronously against a cached zone list,
 * with no network call and no database read.
 *
 * That is deliberate: a boundary crossed inside a tunnel or a dead cell must
 * still be detected. The previous version read prior in/out state from the
 * `safe_zone_states` table on every fix, which meant offline crossings were
 * simply missed. Prior state now lives in IndexedDB (see lib/queue.ts) so it
 * survives reload and works with no connectivity, and the resulting alert is
 * queued with the original crossing timestamp.
 */

export interface ZoneTransition {
  zone: SafeZone;
  entering: boolean;
}

export interface ZoneEvaluation {
  transitions: ZoneTransition[];
  states: Record<string, boolean>;
}

/**
 * A fix this imprecise cannot be trusted to decide a crossing at all.
 * Relative to the zone radius, because 80m accuracy is fine for a 500m campus
 * and useless for a 60m front garden.
 */
function tooImpreciseToJudge(accuracy: number, radius: number): boolean {
  return accuracy > 0 && accuracy >= radius;
}

/**
 * Hysteresis band. Entry requires being comfortably inside and exit requires
 * being comfortably outside, so a stationary phone whose GPS is jittering
 * across the boundary does not spam the family with arrive/leave pairs.
 */
function band(radius: number, accuracy: number) {
  const margin = Math.min(Math.max(accuracy, 10), radius * 0.5);
  return { inner: radius - margin, outer: radius + margin };
}

export function evaluateZoneTransitions(params: {
  latitude: number;
  longitude: number;
  accuracy: number;
  zones: SafeZone[];
  previous: Record<string, boolean>;
}): ZoneEvaluation {
  const { latitude, longitude, accuracy, zones, previous } = params;

  const states: Record<string, boolean> = { ...previous };
  const transitions: ZoneTransition[] = [];

  for (const zone of zones) {
    const distance = getDistanceInMeters(
      latitude,
      longitude,
      zone.latitude,
      zone.longitude
    );

    const wasInside = previous[zone.id];

    // First sighting: remember where we are without announcing an arrival,
    // otherwise merely opening the app at home would report "arrived".
    if (wasInside === undefined) {
      states[zone.id] = distance <= zone.radius;
      continue;
    }

    if (tooImpreciseToJudge(accuracy, zone.radius)) continue;

    const { inner, outer } = band(zone.radius, accuracy);

    if (!wasInside && distance <= inner) {
      states[zone.id] = true;
      if (zone.notify_on_entry) transitions.push({ zone, entering: true });
    } else if (wasInside && distance >= outer) {
      states[zone.id] = false;
      if (zone.notify_on_exit) transitions.push({ zone, entering: false });
    }
    // Between inner and outer: dead band, state intentionally unchanged.
  }

  return { transitions, states };
}

export const LOW_BATTERY_THRESHOLD = 20;

/**
 * True only on the downward crossing of the threshold, so the alert fires once
 * per discharge rather than on every fix below 20%.
 */
export function crossedLowBattery(
  level: number | null,
  previousLevel: number | null
): boolean {
  if (level == null) return false;
  return (
    level <= LOW_BATTERY_THRESHOLD &&
    (previousLevel == null || previousLevel > LOW_BATTERY_THRESHOLD)
  );
}
