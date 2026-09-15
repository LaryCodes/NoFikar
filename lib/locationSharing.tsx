"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/lib/store";
import {
  calculateSpeed,
  getActivityStatus,
  getDistanceInMeters,
  readBatteryLevel,
} from "@/lib/locationUtils";
import {
  crossedLowBattery,
  evaluateZoneTransitions,
  LOW_BATTERY_THRESHOLD,
} from "@/lib/geofence";
import {
  clearQueue,
  enqueueLocation,
  getZoneStates,
  setLastKnownFix,
  setZoneStates,
} from "@/lib/queue";
import { runSync, useQueueStatus, useSyncEngine } from "@/lib/sync";
import { createAlert, type AlertType } from "@/lib/alerts";
import type { ActivityStatus, SafeZone } from "@/types";

/**
 * Owns the ONE geolocation watch for the whole signed-in app, and writes every
 * fix to a durable local queue before it ever touches the network.
 *
 * Ordering matters: GPS -> IndexedDB -> Supabase. Because the sensor does not
 * need connectivity, losing the network only delays delivery, it does not stop
 * recording. That is the entire point of the offline-first design.
 *
 * The watch lives here, in a provider mounted by the app layout, rather than in
 * the Map page. In the page it died on tab navigation while the stored sharing
 * flag stayed true, and its error path left a watcher registered so the next
 * Start stacked a second one.
 */

export interface LocationFix {
  lat: number;
  lng: number;
  accuracy: number;
  at: string;
}

/** Drives every piece of sharing copy in the UI, so states cannot disagree. */
export type SharingMode =
  | "off"
  | "starting"
  | "live"
  | "recording-offline"
  | "syncing";

interface LocationSharingValue {
  sharing: boolean;
  starting: boolean;
  mode: SharingMode;
  /** Human-readable state, e.g. "Offline — recording locally". */
  statusLabel: string;
  online: boolean;
  pendingLocations: number;
  pendingEvents: number;
  syncing: boolean;
  error: string | null;
  clearError: () => void;
  fix: LocationFix | null;
  speed: number;
  activity: ActivityStatus;
  batteryLevel: number | null;
  /** Fixes recorded this session, for drawing the local route while offline. */
  recordedCount: number;
  highFrequency: boolean;
  setHighFrequency: (on: boolean) => void;
  start: () => void;
  stop: () => Promise<void>;
  syncNow: () => Promise<void>;
  prepareSignOut: () => Promise<void>;
}

const LocationSharingContext = createContext<LocationSharingValue | null>(null);

/** Safe-zone list is re-read at most this often while a watch is running. */
const ZONE_CACHE_MS = 60_000;

// --- capture filtering ------------------------------------------------------
// The browser fires watchPosition far more often than a family safety product
// needs. Filtering here is what keeps traffic and battery sane; it is applied
// to PERSISTENCE only — the on-screen readout always shows the newest fix.
const NORMAL_MIN_INTERVAL_MS = 15_000;
const NORMAL_MIN_DISTANCE_M = 20;
/** While an SOS is active, freshness matters more than battery. */
const SOS_MIN_INTERVAL_MS = 5_000;
const SOS_MIN_DISTANCE_M = 5;
/** Record a heartbeat this often even when perfectly still. */
const MAX_INTERVAL_MS = 60_000;
/** Fixes vaguer than this are dropped unless nothing has been recorded yet. */
const ACCURACY_LIMIT_M = 300;
/** profiles row is metadata, not history: it does not need every fix. */
const PROFILE_UPDATE_MS = 30_000;

function describeGeolocationError(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return "Location permission denied. Enable location access for this site in your browser settings, then try again.";
    case err.POSITION_UNAVAILABLE:
      return "Location is unavailable. Check that GPS or location services are on.";
    case err.TIMEOUT:
      return "Location request timed out. Move somewhere with a clearer signal and retry.";
    default:
      return "Could not get your location.";
  }
}

export function LocationSharingProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, currentFamily, locationSharingEnabled, setLocationSharing } =
    useAppStore();

  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fix, setFix] = useState<LocationFix | null>(null);
  const [speed, setSpeed] = useState(0);
  const [activity, setActivity] = useState<ActivityStatus>(getActivityStatus(0));
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [recordedCount, setRecordedCount] = useState(0);
  const [highFrequency, setHighFrequencyState] = useState(false);
  const [online, setOnline] = useState(true);

  const queue = useQueueStatus();
  // The engine runs whenever the app is mounted, not only while sharing: a
  // backlog from a previous session must still drain.
  useSyncEngine(true);

  const watchIdRef = useRef<number | null>(null);
  const lastRecordedRef = useRef<{ lat: number; lng: number; time: number } | null>(
    null
  );
  const lastUiPositionRef = useRef<{ lat: number; lng: number; time: number } | null>(
    null
  );
  const lastBatteryRef = useRef<number | null>(null);
  const lastProfileWriteRef = useRef(0);
  const zonesRef = useRef<{ zones: SafeZone[]; at: number }>({ zones: [], at: 0 });
  const highFrequencyRef = useRef(false);
  const announcedRef = useRef(false);

  // The watch callback is registered once but must always see current values,
  // so these are read through refs rather than closed over.
  const userRef = useRef(user);
  userRef.current = user;
  const familyRef = useRef(currentFamily);
  familyRef.current = currentFamily;

  useEffect(() => {
    setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  const setHighFrequency = useCallback((on: boolean) => {
    highFrequencyRef.current = on;
    setHighFrequencyState(on);
  }, []);

  const clearWatch = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  const loadZones = useCallback(async (familyId: string): Promise<SafeZone[]> => {
    const cache = zonesRef.current;
    if (Date.now() - cache.at < ZONE_CACHE_MS) return cache.zones;

    // Offline: keep using the cached list rather than wiping it to empty.
    if (!navigator.onLine) return cache.zones;

    const { data, error: err } = await supabase
      .from("safe_zones")
      .select("*")
      .eq("family_id", familyId);

    if (err) return cache.zones;

    zonesRef.current = { zones: (data ?? []) as SafeZone[], at: Date.now() };
    return zonesRef.current.zones;
  }, []);

  /** Queues an alert. Delivered immediately when online, replayed when not. */
  const queueAlert = useCallback(
    async (payload: {
      type: AlertType;
      title: string;
      message?: string;
      data?: Record<string, unknown>;
      recordedAt?: string;
    }) => {
      const activeUser = userRef.current;
      const activeFamily = familyRef.current;
      if (!activeUser || !activeFamily) return;

      await createAlert({
        familyId: activeFamily.id,
        userId: activeUser.id,
        ...payload,
      });
    },
    []
  );

  /** Persistence filter. Returns true when this fix is worth keeping. */
  const shouldRecord = useCallback(
    (latitude: number, longitude: number, accuracy: number): boolean => {
      const previous = lastRecordedRef.current;
      if (!previous) return true;

      const elapsed = Date.now() - previous.time;
      if (elapsed >= MAX_INTERVAL_MS) return true;

      if (accuracy > ACCURACY_LIMIT_M) return false;

      const minInterval = highFrequencyRef.current
        ? SOS_MIN_INTERVAL_MS
        : NORMAL_MIN_INTERVAL_MS;
      const minDistance = highFrequencyRef.current
        ? SOS_MIN_DISTANCE_M
        : NORMAL_MIN_DISTANCE_M;

      const moved = getDistanceInMeters(
        previous.lat,
        previous.lng,
        latitude,
        longitude
      );

      // Meaningful movement gets through early; otherwise wait out the interval.
      if (moved >= minDistance && elapsed >= 2_000) return true;
      return elapsed >= minInterval;
    },
    []
  );

  const start = useCallback(() => {
    setError(null);

    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setError("This browser does not support location sharing.");
      return;
    }
    if (!userRef.current || !familyRef.current) {
      setError("Still loading your profile. Try again in a moment.");
      return;
    }
    // Never stack watchers. If one is already registered this is a no-op.
    if (watchIdRef.current !== null) {
      setLocationSharing(true);
      return;
    }

    setStarting(true);
    announcedRef.current = false;

    watchIdRef.current = navigator.geolocation.watchPosition(
      async (position) => {
        const activeUser = userRef.current;
        const activeFamily = familyRef.current;
        if (!activeUser || !activeFamily) return;

        setStarting(false);
        setLocationSharing(true);

        const {
          latitude,
          longitude,
          accuracy,
          speed: gpsSpeed,
          heading,
          altitude,
        } = position.coords;
        const recordedAt = new Date().toISOString();
        const offline = !navigator.onLine;

        // --- on-screen readout: always the newest fix, filtered or not ------
        let kmh = 0;
        if (gpsSpeed != null && gpsSpeed >= 0) {
          kmh = gpsSpeed * 3.6;
        } else if (lastUiPositionRef.current) {
          kmh = calculateSpeed(
            null,
            lastUiPositionRef.current.lat,
            lastUiPositionRef.current.lng,
            latitude,
            longitude,
            Date.now() - lastUiPositionRef.current.time
          );
        }
        lastUiPositionRef.current = {
          lat: latitude,
          lng: longitude,
          time: Date.now(),
        };

        const status = getActivityStatus(kmh);
        setFix({ lat: latitude, lng: longitude, accuracy, at: recordedAt });
        setSpeed(kmh);
        setActivity(status);

        if (!shouldRecord(latitude, longitude, accuracy)) return;

        const battery = await readBatteryLevel();
        setBatteryLevel(battery);

        // --- durable local write, before any network attempt ---------------
        await enqueueLocation({
          userId: activeUser.id,
          familyId: activeFamily.id,
          latitude,
          longitude,
          accuracy: accuracy ?? 0,
          speed: kmh,
          heading: heading != null && !Number.isNaN(heading) ? heading : null,
          altitude: altitude ?? null,
          batteryLevel: battery,
          activityStatus: status.label,
          recordedAt,
          offline,
        });

        await setLastKnownFix({
          user_id: activeUser.id,
          latitude,
          longitude,
          accuracy: accuracy ?? 0,
          speed: kmh,
          activity_status: status.label,
          battery_level: battery,
          recorded_at: recordedAt,
          captured_offline: offline,
        });

        lastRecordedRef.current = { lat: latitude, lng: longitude, time: Date.now() };
        setRecordedCount((n) => n + 1);

        if (!announcedRef.current) {
          announcedRef.current = true;
          await queueAlert({
            type: "sharing_enabled",
            title: `${activeUser.name ?? "A family member"} started sharing location`,
            message: "Live location updates are now on.",
            recordedAt,
          });
        }

        // --- geofencing, evaluated locally so offline crossings count ------
        const zones = await loadZones(activeFamily.id);
        if (zones.length > 0) {
          const previous = await getZoneStates();
          const { transitions, states } = evaluateZoneTransitions({
            latitude,
            longitude,
            accuracy: accuracy ?? 0,
            zones,
            previous,
          });

          if (transitions.length > 0) await setZoneStates(states);
          else if (Object.keys(states).length !== Object.keys(previous).length) {
            // First sighting of a new zone: persist the seeded state silently.
            await setZoneStates(states);
          }

          for (const { zone, entering } of transitions) {
            await queueAlert({
              type: entering ? "zone_entry" : "zone_exit",
              title: entering
                ? `${activeUser.name ?? "A family member"} arrived at ${zone.name}`
                : `${activeUser.name ?? "A family member"} left ${zone.name}`,
              message: entering
                ? `Entered the ${zone.name} safe zone.`
                : `Left the ${zone.name} safe zone.`,
              // The crossing time, not the delivery time.
              recordedAt,
              data: { zone_id: zone.id, zone_name: zone.name },
            });
          }
        }

        if (crossedLowBattery(battery, lastBatteryRef.current)) {
          await queueAlert({
            type: "low_battery",
            title: `${activeUser.name ?? "A family member"}'s battery is at ${battery}%`,
            message: `Below ${LOW_BATTERY_THRESHOLD}% — location updates may stop if the device powers off.`,
            recordedAt,
            data: { battery_level: battery },
          });
        }
        lastBatteryRef.current = battery;

        // --- delivery ------------------------------------------------------
        if (!offline) {
          void runSync();

          if (Date.now() - lastProfileWriteRef.current > PROFILE_UPDATE_MS) {
            lastProfileWriteRef.current = Date.now();
            const { error: profileError } = await supabase
              .from("profiles")
              .update({
                battery_level: battery,
                location_sharing_enabled: true,
                last_active: recordedAt,
              })
              .eq("id", activeUser.id);
            // A failed metadata write must not look like lost location data:
            // the fix is already safe in the queue.
            if (profileError) {
              console.warn("Profile heartbeat failed:", profileError.message);
            }
          }
          setError(null);
        }
      },
      (err) => {
        // Tear the watch down here. Leaving it registered while the UI shows
        // "not sharing" was how duplicate watchers were created.
        clearWatch();
        setStarting(false);
        setLocationSharing(false);
        console.error("Geolocation error:", err);
        setError(describeGeolocationError(err));
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
  }, [clearWatch, loadZones, queueAlert, setLocationSharing, shouldRecord]);

  const stop = useCallback(async () => {
    clearWatch();
    setStarting(false);
    setLocationSharing(false);
    setSpeed(0);
    setActivity(getActivityStatus(0));
    setHighFrequency(false);
    lastRecordedRef.current = null;
    lastUiPositionRef.current = null;

    const activeUser = userRef.current;
    const activeFamily = familyRef.current;
    if (!activeUser || !activeFamily) return;

    // Queued so the family still learns sharing stopped even if this happened
    // with no connectivity.
    await queueAlert({
      type: "sharing_disabled",
      title: `${activeUser.name ?? "A family member"} stopped sharing location`,
      message: "Live location updates have been turned off.",
    });

    if (!navigator.onLine) {
      setError(
        "Sharing stopped on this device. Your family will see the change when you reconnect."
      );
      return;
    }

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ location_sharing_enabled: false })
      .eq("id", activeUser.id);

    if (updateError) {
      setError(
        "Sharing stopped on this device, but we could not update your family. They will stop seeing you as live shortly."
      );
    }

    // Push out anything still queued, including the alert above.
    void runSync();
  }, [clearWatch, queueAlert, setHighFrequency, setLocationSharing]);

  /**
   * Flush before sign-out, then drop the queue. Retaining it would be worse
   * than losing it: location_history INSERT requires auth.uid() = user_id, so
   * another account signing in on this device could never sync those rows.
   */
  const prepareSignOut = useCallback(async () => {
    if (watchIdRef.current !== null) await stop();
    if (navigator.onLine) await runSync();
    await clearQueue();
  }, [stop]);

  // Reflect an externally-changed profile flag (e.g. the Settings toggle on
  // another device) by tearing down a watch that is no longer authorised.
  useEffect(() => {
    if (!locationSharingEnabled) clearWatch();
  }, [locationSharingEnabled, clearWatch]);

  // Best-effort: clear the stored flag when the sharing device goes away, so
  // the family is not left looking at a pin labelled LIVE. An unload-time
  // request is not guaranteed to complete, which is exactly why presence is
  // *also* derived from fix recency in lib/presence.ts.
  useEffect(() => {
    const handlePageHide = () => {
      if (watchIdRef.current === null) return;
      const activeUser = userRef.current;
      if (!activeUser || !navigator.onLine) return;
      void supabase
        .from("profiles")
        .update({ location_sharing_enabled: false })
        .eq("id", activeUser.id);
    };

    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, []);

  // Provider unmount means the signed-in app is gone, so release the watch.
  useEffect(() => clearWatch, [clearWatch]);

  const pending = queue.pendingLocations + queue.pendingEvents;

  let mode: SharingMode = "off";
  if (starting) mode = "starting";
  else if (locationSharingEnabled && !online) mode = "recording-offline";
  else if (locationSharingEnabled && queue.syncing && pending > 0) mode = "syncing";
  else if (locationSharingEnabled) mode = "live";
  else if (queue.syncing && pending > 0) mode = "syncing";

  const statusLabel: Record<SharingMode, string> = {
    off: "Location sharing is off",
    starting: "Getting your location…",
    live: "Sharing live",
    "recording-offline": "Offline — recording locally",
    syncing: "Back online — syncing",
  };

  return (
    <LocationSharingContext.Provider
      value={{
        sharing: locationSharingEnabled,
        starting,
        mode,
        statusLabel: statusLabel[mode],
        online,
        pendingLocations: queue.pendingLocations,
        pendingEvents: queue.pendingEvents,
        syncing: queue.syncing,
        error,
        clearError: () => setError(null),
        fix,
        speed,
        activity,
        batteryLevel,
        recordedCount,
        highFrequency,
        setHighFrequency,
        start,
        stop,
        syncNow: runSync,
        prepareSignOut,
      }}
    >
      {children}
    </LocationSharingContext.Provider>
  );
}

export function useLocationSharing(): LocationSharingValue {
  const ctx = useContext(LocationSharingContext);
  if (!ctx) {
    throw new Error(
      "useLocationSharing must be used inside <LocationSharingProvider>"
    );
  }
  return ctx;
}
