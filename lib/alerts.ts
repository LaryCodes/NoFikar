import { enqueueEvent } from "@/lib/queue";
import { runSync } from "@/lib/sync";

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
  /**
   * When the thing being reported actually happened. Defaults to now. Pass the
   * original moment for anything detected offline — a safe-zone crossing in a
   * tunnel must not be timestamped when the network came back.
   */
  recordedAt?: string;
}

/**
 * Writes an alert through the offline queue rather than straight to Supabase.
 *
 * Two reasons:
 *   1. A safe-zone crossing or an SOS raised with no connectivity is still a
 *      real safety event, and must reach the family once the network returns.
 *   2. The queue's client-generated id makes replay idempotent, so a retry
 *      cannot produce duplicate alerts.
 *
 * Never throws: an alert is a side-effect of some other action (a GPS ping, a
 * button press) and must not be able to fail that action.
 */
export async function createAlert({
  familyId,
  userId,
  type,
  title,
  message,
  data,
  recordedAt,
}: CreateAlertInput): Promise<{ error: Error | null; queued: boolean }> {
  try {
    await enqueueEvent({
      userId,
      familyId,
      kind: "alert",
      recordedAt,
      offline: typeof navigator !== "undefined" && !navigator.onLine,
      payload: {
        type,
        title,
        message: message ?? null,
        data: data ?? null,
      },
    });

    const offline = typeof navigator !== "undefined" && !navigator.onLine;
    if (!offline) void runSync();

    return { error: null, queued: offline };
  } catch (err) {
    console.error(`Failed to queue "${type}" alert:`, err);
    return { error: err as Error, queued: false };
  }
}
