import { supabase } from "@/lib/supabase";

/**
 * Creates a consent request for a family member's camera or microphone.
 *
 * This only ever writes a `pending` row. Nothing is captured until the target
 * explicitly approves on their own device, and the approval path (getUserMedia,
 * the WebRTC offer, the visible "sharing active" state, the expiry timer) lives
 * entirely in components/EmergencySessions.tsx. Keeping request creation
 * separate lets the map offer the action without duplicating that lifecycle.
 *
 * Deliberately not queued for offline replay: a live stream is meaningless
 * without a connection, and a request that silently arrived hours later would
 * be worse than a clear failure.
 */
export async function requestMediaSession(params: {
  familyId: string;
  requesterId: string;
  targetId: string;
  kind: "camera" | "audio";
}): Promise<{ error: Error | null }> {
  const { familyId, requesterId, targetId, kind } = params;

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return {
      error: new Error(
        "You need a connection to request a live camera or microphone session."
      ),
    };
  }

  if (requesterId === targetId) {
    return { error: new Error("You cannot request your own camera.") };
  }

  try {
    // Don't stack requests: an existing pending or active session for this pair
    // should be answered rather than duplicated.
    const { data: existing, error: lookupError } = await supabase
      .from("emergency_sessions")
      .select("id, status")
      .eq("family_id", familyId)
      .eq("requester_id", requesterId)
      .eq("target_id", targetId)
      .in("status", ["pending", "active"])
      .limit(1);

    if (lookupError) throw lookupError;

    if ((existing ?? []).length > 0) {
      return {
        error: new Error(
          "There is already a pending or active session with this person."
        ),
      };
    }

    const { error } = await supabase.from("emergency_sessions").insert({
      family_id: familyId,
      requester_id: requesterId,
      target_id: targetId,
      session_type: kind,
      status: "pending",
    });

    if (error) throw error;
    return { error: null };
  } catch (err) {
    console.error("Failed to request media session:", err);
    return { error: err as Error };
  }
}
