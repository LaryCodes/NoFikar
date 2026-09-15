/**
 * Presence rules for the map and family list.
 *
 * `profiles.location_sharing_enabled` is a stored flag, so on its own it lies:
 * a phone that lost signal, closed the tab, or ran out of battery leaves the
 * flag set to true forever and the family keeps seeing a stale pin labelled
 * LIVE. Recency of the newest location_history row is the only trustworthy
 * signal, so presence is derived from both.
 */

/** A fix newer than this is treated as a live position. */
export const LIVE_WINDOW_MS = 90_000;

/** Past this, the person is treated as offline regardless of the stored flag. */
export const STALE_WINDOW_MS = 10 * 60_000;

export type Presence = "live" | "stale" | "offline";

export function presenceFor(params: {
  sharingEnabled?: boolean | null;
  lastFixAt?: string | null;
  now?: number;
}): Presence {
  const { sharingEnabled, lastFixAt, now = Date.now() } = params;
  if (!lastFixAt) return "offline";

  const age = now - new Date(lastFixAt).getTime();
  if (Number.isNaN(age)) return "offline";

  if (sharingEnabled && age <= LIVE_WINDOW_MS) return "live";
  if (age <= STALE_WINDOW_MS) return "stale";
  return "offline";
}

export const PRESENCE_LABEL: Record<Presence, string> = {
  live: "Live",
  stale: "Last seen",
  offline: "Offline",
};
