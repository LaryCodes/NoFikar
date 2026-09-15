import { supabase } from "@/lib/supabase";
import { createAlert } from "@/lib/alerts";
import { getActivityStatus, readBatteryLevel } from "@/lib/locationUtils";
import type { EmergencySession, SosContext } from "@/types";

/**
 * An SOS is an emergency *state*, not a one-off notification.
 *
 * It is stored as an `emergency_sessions` row with session_type = 'sos', which
 * the schema already allowed. `target_id` is set to the requester because an
 * SOS is addressed to the whole family rather than one person. The row is what
 * lets both sides show a persistent banner, lets a responder acknowledge, and
 * lets the sender resolve it — none of which is possible with an alert alone.
 *
 * The alert row is still written so the SOS also appears in the alerts feed;
 * the existing alert system is unchanged, just enriched with a session_id.
 */

function getPosition(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      return resolve(null);
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

/** Collects only what the device can actually report. */
export async function captureSosContext(): Promise<SosContext> {
  const [position, battery] = await Promise.all([
    getPosition(),
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
  }

  return context;
}

export async function triggerSos(params: {
  familyId: string;
  userId: string;
  userName: string;
}): Promise<{ session: EmergencySession | null; error: Error | null }> {
  const { familyId, userId, userName } = params;

  try {
    const context = await captureSosContext();

    const { data, error } = await supabase
      .from("emergency_sessions")
      .insert({
        family_id: familyId,
        requester_id: userId,
        target_id: userId,
        session_type: "sos",
        status: "active",
        approved_at: new Date().toISOString(),
        data: context,
      })
      .select()
      .single();

    if (error) throw error;
    const session = data as EmergencySession;

    // A location ping so the SOS shows up on the family map immediately, even
    // if the sender was not sharing live location.
    if (context.latitude != null && context.longitude != null) {
      await supabase.from("location_history").insert({
        user_id: userId,
        family_id: familyId,
        latitude: context.latitude,
        longitude: context.longitude,
        speed: context.speed ?? 0,
        accuracy: context.accuracy ?? 0,
        activity_status: "SOS",
        battery_level: context.battery_level ?? null,
      });
    }

    const details = [
      context.latitude != null ? "Location attached" : "Location unavailable",
      context.battery_level != null ? `battery ${context.battery_level}%` : null,
      context.online === false ? "device was offline" : null,
    ]
      .filter(Boolean)
      .join(" · ");

    await createAlert({
      familyId,
      userId,
      type: "sos",
      title: `🆘 SOS — ${userName} needs help`,
      message: details,
      data: { session_id: session.id, ...context },
    });

    return { session, error: null };
  } catch (err) {
    console.error("Failed to trigger SOS:", err);
    return { session: null, error: err as Error };
  }
}

export async function acknowledgeSos(params: {
  session: EmergencySession;
  userId: string;
  userName: string;
}): Promise<{ error: Error | null }> {
  const { session, userId, userName } = params;
  try {
    const { error } = await supabase
      .from("emergency_sessions")
      .update({
        acknowledged_by: userId,
        acknowledged_at: new Date().toISOString(),
      })
      .eq("id", session.id);
    if (error) throw error;

    await createAlert({
      familyId: session.family_id,
      userId,
      type: "help",
      title: `${userName} is responding to the SOS`,
      message: "Acknowledged the emergency.",
      data: { session_id: session.id },
    });

    return { error: null };
  } catch (err) {
    console.error("Failed to acknowledge SOS:", err);
    return { error: err as Error };
  }
}

/**
 * `resolved` = the person confirmed they are safe.
 * `ended`    = the SOS was closed without a safety confirmation (e.g. a
 *              mis-press cancelled after the countdown had already elapsed).
 */
export async function closeSos(params: {
  session: EmergencySession;
  userId: string;
  userName: string;
  outcome: "resolved" | "ended";
}): Promise<{ error: Error | null }> {
  const { session, userId, userName, outcome } = params;
  try {
    const { error } = await supabase
      .from("emergency_sessions")
      .update({ status: outcome, ended_at: new Date().toISOString() })
      .eq("id", session.id);
    if (error) throw error;

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
      data: { session_id: session.id },
    });

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
