import { supabase } from "@/lib/supabase";
import type { Profile } from "@/types";

/**
 * Guarantees a `profiles` row exists for the signed-in user and returns it.
 *
 * Every user-referencing foreign key (family_members, location_history,
 * alerts, emergency_sessions) points at profiles(id). If the row is missing,
 * joining a family, sending an SOS, and writing a location all fail with an
 * opaque foreign-key error.
 *
 * A database trigger normally creates this row on signup, but a trigger is a
 * single point of failure — accounts created while the trigger was broken, or
 * during an email-uniqueness collision, end up without one. Repairing it here
 * means the app heals itself instead of stranding the account.
 *
 * Safe to call on every app entry: it is an idempotent upsert.
 */
export async function ensureProfile(): Promise<{
  profile: Profile | null;
  error: Error | null;
}> {
  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError) throw authError;
    if (!user) return { profile: null, error: new Error("Not authenticated") };

    // Fast path: already present.
    const { data: existing, error: readError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    if (readError) throw readError;
    if (existing) return { profile: existing as Profile, error: null };

    // Repair path.
    const fallbackName =
      (user.user_metadata?.name as string | undefined)?.trim() ||
      user.email?.split("@")[0] ||
      "Family member";

    const { data: created, error: writeError } = await supabase
      .from("profiles")
      .upsert(
        {
          id: user.id,
          email: user.email ?? null,
          name: fallbackName,
        },
        { onConflict: "id" }
      )
      .select()
      .maybeSingle();

    if (writeError) throw writeError;

    return { profile: (created as Profile) ?? null, error: null };
  } catch (err) {
    console.error("ensureProfile failed:", err);
    return { profile: null, error: err as Error };
  }
}
