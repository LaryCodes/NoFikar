import { supabase } from "@/lib/supabase";

/**
 * Every alert type the app can emit. Keeping this a union (rather than free
 * strings scattered across components) means the feed can render an icon and
 * label for anything that gets written.
 */
export type AlertType =
  | "sos"
  | "safe"
  | "help"
  | "zone_entry"
  | "zone_exit"
  | "low_battery"
  | "sharing_enabled"
  | "sharing_disabled"
  | "emergency_session_started"
  | "emergency_session_ended";

export const ALERT_META: Record<AlertType, { icon: string; label: string }> = {
  sos: { icon: "🆘", label: "Emergency SOS" },
  safe: { icon: "✅", label: "Checked in safe" },
  help: { icon: "⚠️", label: "Help requested" },
  zone_entry: { icon: "📍", label: "Arrived" },
  zone_exit: { icon: "🚪", label: "Left" },
  low_battery: { icon: "🔋", label: "Low battery" },
  sharing_enabled: { icon: "📡", label: "Sharing started" },
  sharing_disabled: { icon: "🔕", label: "Sharing stopped" },
  emergency_session_started: { icon: "🎥", label: "Emergency session started" },
  emergency_session_ended: { icon: "⏹️", label: "Emergency session ended" },
};

export interface CreateAlertInput {
  familyId: string;
  userId: string;
  type: AlertType;
  title: string;
  message?: string;
  data?: Record<string, unknown>;
}

/**
 * Writes an alert. Never throws: an alert is a side-effect of some other
 * action (a GPS ping, a button press) and must not fail that action. Callers
 * that care can inspect the returned error.
 */
export async function createAlert({
  familyId,
  userId,
  type,
  title,
  message,
  data,
}: CreateAlertInput): Promise<{ error: Error | null }> {
  try {
    const { error } = await supabase.from("alerts").insert({
      family_id: familyId,
      user_id: userId,
      type,
      title,
      message: message ?? null,
      data: data ? { ...data, at: new Date().toISOString() } : null,
    });
    if (error) throw error;
    return { error: null };
  } catch (err) {
    console.error(`Failed to create "${type}" alert:`, err);
    return { error: err as Error };
  }
}
