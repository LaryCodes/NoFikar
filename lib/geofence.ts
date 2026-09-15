import { supabase } from "@/lib/supabase";
import { getDistanceInMeters } from "@/lib/locationUtils";
import { createAlert } from "@/lib/alerts";
import type { SafeZone } from "@/types";

/**
 * Evaluates a position against the family's safe zones and emits
 * zone_entry / zone_exit alerts only on an actual transition.
 *
 * Prior in/out state lives in the `safe_zone_states` table rather than in
 * component state, so transitions are still detected correctly across page
 * reloads, tab changes, and different devices.
 */
export async function evaluateSafeZones(params: {
  familyId: string;
  userId: string;
  userName: string;
  latitude: number;
  longitude: number;
  zones: SafeZone[];
}): Promise<void> {
  const { familyId, userId, userName, latitude, longitude, zones } = params;
  if (zones.length === 0) return;

  try {
    const { data: states, error } = await supabase
      .from("safe_zone_states")
      .select("zone_id, is_inside")
      .eq("user_id", userId);

    if (error) throw error;

    const previous = new Map<string, boolean>(
      (states ?? []).map((s) => [s.zone_id as string, s.is_inside as boolean])
    );

    for (const zone of zones) {
      const distance = getDistanceInMeters(
        latitude,
        longitude,
        zone.latitude,
        zone.longitude
      );
      const isInside = distance <= zone.radius;
      const wasInside = previous.get(zone.id);

      // First sighting: record the state without firing an alert, otherwise
      // simply opening the app inside a zone would report an "arrival".
      if (wasInside === undefined) {
        await supabase.from("safe_zone_states").upsert(
          { zone_id: zone.id, user_id: userId, is_inside: isInside, updated_at: new Date().toISOString() },
          { onConflict: "zone_id,user_id" }
        );
        continue;
      }

      if (wasInside === isInside) continue;

      await supabase.from("safe_zone_states").upsert(
        { zone_id: zone.id, user_id: userId, is_inside: isInside, updated_at: new Date().toISOString() },
        { onConflict: "zone_id,user_id" }
      );

      const entering = isInside;
      if ((entering && zone.notify_on_entry) || (!entering && zone.notify_on_exit)) {
        await createAlert({
          familyId,
          userId,
          type: entering ? "zone_entry" : "zone_exit",
          title: entering ? `${userName} arrived at ${zone.name}` : `${userName} left ${zone.name}`,
          message: entering
            ? `Entered the ${zone.name} safe zone.`
            : `Left the ${zone.name} safe zone.`,
          data: { zone_id: zone.id, zone_name: zone.name },
        });
      }
    }
  } catch (err) {
    // Geofencing is advisory; a failure here must not break location sharing.
    console.error("Safe zone evaluation failed:", err);
  }
}

export const LOW_BATTERY_THRESHOLD = 20;

/**
 * Emits a low_battery alert when the level crosses below the threshold.
 * Returns the level to remember so the caller can detect the next crossing.
 */
export async function checkLowBattery(params: {
  familyId: string;
  userId: string;
  userName: string;
  level: number | null;
  previousLevel: number | null;
}): Promise<void> {
  const { familyId, userId, userName, level, previousLevel } = params;
  if (level == null) return;

  const crossed =
    level <= LOW_BATTERY_THRESHOLD &&
    (previousLevel == null || previousLevel > LOW_BATTERY_THRESHOLD);

  if (!crossed) return;

  await createAlert({
    familyId,
    userId,
    type: "low_battery",
    title: `${userName}'s battery is at ${level}%`,
    message: "Location updates may stop if the device powers off.",
    data: { battery_level: level },
  });
}
