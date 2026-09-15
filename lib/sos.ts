import { supabase } from "@/lib/supabase";
import { createAlert } from "@/lib/alerts";
import { getActivityStatus, readBatteryLevel } from "@/lib/locationUtils";
import {
  enqueueEvent,
  enqueueLocation,
  getLastKnownFix,
  newLocalId,
} from "@/lib/queue";
import { runSync } from "@/lib/sync";
import type { EmergencySession, SosContext } from "@/types";

/**
 * An SOS is an emergency *state*, not a one-off notification.
 *
 * It is stored as an `emergency_sessions` row with session_type = 'sos', which
 * the schema already allowed. `target_id` equals the requester because an SOS
 * addresses the whole family rather than one person. The row is what lets both
 * sides show a persistent banner, lets a responder acknowledge, and lets the
 * sender resolve it — none of which an alert alone can do.
 *
 * Everything routes through the offline queue with a client-generated id, so:
 *   * an SOS raised with no signal is still recorded and delivered later,
 *   * replaying it cannot create a second emergency,
 *   * the original trigger time is preserved rather than the delivery time.
 *
 * The caller is responsible for showing "queued" honestly: this module never
 * claims the family has been reached while the device is offline.
 */

function getPosition(timeoutMs: number): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      return resolve(null);
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 }
    );
  });
}

/**
 * Collects only what the device can actually report, falling back to the stored
 * last-known position when GPS cannot produce a fresh fix (indoors, cold start,
 * permission revoked). The fallback is explicitly flagged.
 */
export async function captureSosContext(userId: string): Promise<SosContext> {
  const [position, battery] = await Promise.all([
    // Short timeout: an emergency must not wait 20s for a perfect fix.
    getPosition(8000),
    readBatteryLevel(),
  ]);

  const context: SosContext = {
    battery_level: battery,
    online: typeof navigator === "undefined" ? true : navigator.onLine,
    triggered_at: new Date().toISOString(),
  };

  if (position) {
    const kmh =
      position.coords.speed != null && position.coords.speed >= 0
        ? position.coords.speed * 3.6
        : 0;

    context.latitude = position.coords.latitude;
    context.longitude = position.coords.longitude;
    context.accuracy = position.coords.accuracy;
    context.speed = kmh;
    context.activity_status = getActivityStatus(kmh).label;
    context.is_last_known = false;
    context.fix_at = new Date(position.timestamp).toISOString();
    context.fix_age_ms = Math.max(0, Date.now() - position.timestamp);
    return context;
  }

  const lastKnown = await getLastKnownFix(userId);
  if (lastKnown) {
    context.latitude = lastKnown.latitude;
    context.longitude = lastKnown.longitude;
    context.accuracy = lastKnown.accuracy;
    context.speed = lastKnown.speed;
    context.activity_status = lastKnown.activity_status;
    context.is_last_known = true;
    context.fix_at = lastKnown.recorded_at;
    context.fix_age_ms = Math.max(
      0,
      Date.now() - new Date(lastKnown.recorded_at).getTime()
    );
  }

  return context;
}

export interface TriggerSosResult {
  session: EmergencySession | null;
  /** True when the emergency is recorded locally but not yet delivered. */
  queued: boolean;
  error: Error | null;
}

export async function triggerSos(params: {
  familyId: string;
  userId: string;
  userName: string;
}): Promise<TriggerSosResult> {
  const { familyId, userId, userName } = params;

  try {
    const context = await captureSosContext(userId);
    const sessionId = newLocalId();
    const triggeredAt = context.triggered_at ?? new Date().toISOString();
    const offline = typeof navigator !== "undefined" && !navigator.onLine;

    await enqueueEvent({
      userId,
      familyId,
      kind: "sos_start",
      recordedAt: triggeredAt,
      offline,
      payload: { session_id: sessionId, data: context },
    });

    // A location row so the SOS is immediately visible on the family map, even
    // if the sender was never sharing live location. Only when the position is
    // fresh: replaying a stale fix as a new point would corrupt the route.
    if (
      context.latitude != null &&
      context.longitude != null &&
      !context.is_last_known
    ) {
      await enqueueLocation({
        userId,
        familyId,
        latitude: context.latitude,
        longitude: context.longitude,
        accuracy: context.accuracy ?? 0,
        speed: context.speed ?? 0,
        heading: null,
        altitude: null,
        batteryLevel: context.battery_level ?? null,
        activityStatus: "SOS",
        recordedAt: triggeredAt,
        offline,
      });
    }

    const details = [
      context.latitude == null
        ? "Location unavailable"
        : context.is_last_known
        ? "Last known location attached"
        : "Live location attached",
      context.battery_level != null ? `battery ${context.battery_level}%` : null,
      offline ? "raised while offline" : null,
    ]
      .filter(Boolean)
      .join(" · ");

    await createAlert({
      familyId,
      userId,
      type: "sos",
      title: `🆘 SOS — ${userName} needs help`,
      message: details,
      recordedAt: triggeredAt,
      data: { session_id: sessionId, ...context },
    });

    if (!offline) await runSync();

    // Constructed locally so the sender's banner appears instantly and survives
    // a reload; the synced row carries this same id.
    const session: EmergencySession = {
      id: sessionId,
      family_id: familyId,
      requester_id: userId,
      target_id: userId,
      session_type: "sos",
      status: "active",
      data: context,
      acknowledged_by: null,
      acknowledged_at: null,
      approved_at: triggeredAt,
      created_at: triggeredAt,
    };

    return { session, queued: offline, error: null };
  } catch (err) {
    console.error("Failed to trigger SOS:", err);
    return { session: null, queued: false, error: err as Error };
  }
}

export async function acknowledgeSos(params: {
  session: EmergencySession;
  userId: string;
  userName: string;
}): Promise<{ error: Error | null }> {
  const { session, userId, userName } = params;
  try {
    const at = new Date().toISOString();

    await enqueueEvent({
      userId,
      familyId: session.family_id,
      kind: "sos_ack",
      recordedAt: at,
      offline: !navigator.onLine,
      payload: { session_id: session.id },
    });

    await createAlert({
      familyId: session.family_id,
      userId,
      type: "help",
      title: `${userName} is responding to the SOS`,
      message: "Acknowledged the emergency.",
      recordedAt: at,
      data: { session_id: session.id },
    });

    if (navigator.onLine) await runSync();
    return { error: null };
  } catch (err) {
    console.error("Failed to acknowledge SOS:", err);
    return { error: err as Error };
  }
}

/**
 * `resolved` = the person confirmed they are safe.
 * `ended`    = the SOS was closed without a safety confirmation.
 */
export async function closeSos(params: {
  session: EmergencySession;
  userId: string;
  userName: string;
  outcome: "resolved" | "ended";
}): Promise<{ error: Error | null }> {
  const { session, userId, userName, outcome } = params;
  try {
    const at = new Date().toISOString();

    await enqueueEvent({
      userId,
      familyId: session.family_id,
      kind: "sos_close",
      recordedAt: at,
      offline: !navigator.onLine,
      payload: { session_id: session.id, status: outcome },
    });

    await createAlert({
      familyId: session.family_id,
      userId,
      type: outcome === "resolved" ? "safe" : "help",
      title:
        outcome === "resolved"
          ? `${userName} is safe — SOS resolved`
          : `SOS from ${userName} was closed`,
      message:
        outcome === "resolved"
          ? "Marked themselves safe and ended the emergency."
          : "The emergency was closed without a safety confirmation.",
      recordedAt: at,
      data: { session_id: session.id },
    });

    if (navigator.onLine) await runSync();
    return { error: null };
  } catch (err) {
    console.error("Failed to close SOS:", err);
    return { error: err as Error };
  }
}

/** Active SOS sessions for a family, newest first. */
export async function fetchActiveSos(
  familyId: string
): Promise<EmergencySession[]> {
  const { data, error } = await supabase
    .from("emergency_sessions")
    .select("*")
    .eq("family_id", familyId)
    .eq("session_type", "sos")
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to load active SOS sessions:", error);
    return [];
  }
  return (data ?? []) as EmergencySession[];
}
