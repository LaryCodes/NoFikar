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
  readBatteryLevel,
} from "@/lib/locationUtils";
import { evaluateSafeZones, checkLowBattery } from "@/lib/geofence";
import { createAlert } from "@/lib/alerts";
import type { ActivityStatus, SafeZone } from "@/types";

/**
 * Owns the ONE geolocation watch for the whole signed-in app.
 *
 * Previously the watch lived inside the Map page component, which caused three
 * separate problems:
 *   1. Navigating to any other tab unmounted the page, cleared the watch, and
 *      left `profiles.location_sharing_enabled = true` — so sharing silently
 *      died while the family still saw the user as LIVE.
 *   2. The geolocation error callback flipped the UI back to "not sharing"
 *      without calling clearWatch, so the next Start created a second watcher
 *      that could never be cleared. Repeat that and updates pile up.
 *   3. Stop was only reachable from the Map tab.
 *
 * Hoisting it to a provider mounted in the app layout means: exactly one
 * watcher, it survives tab navigation, and start/stop is reachable from
 * anywhere (Map and Settings both drive this same state).
 */

export interface LocationFix {
  lat: number;
  lng: number;
  accuracy: number;
  at: string;
}

interface LocationSharingValue {
  sharing: boolean;
  starting: boolean;
  error: string | null;
  clearError: () => void;
  fix: LocationFix | null;
  speed: number;
  activity: ActivityStatus;
  batteryLevel: number | null;
  start: () => void;
  stop: () => Promise<void>;
}

const LocationSharingContext = createContext<LocationSharingValue | null>(null);

/** Safe-zone list is re-read at most this often while a watch is running. */
const ZONE_CACHE_MS = 60_000;

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

  const watchIdRef = useRef<number | null>(null);
  const lastPositionRef = useRef<{ lat: number; lng: number; time: number } | null>(
    null
  );
  const lastBatteryRef = useRef<number | null>(null);
  const zonesRef = useRef<{ zones: SafeZone[]; at: number }>({ zones: [], at: 0 });

  // The watch callback is registered once but must always see the current
  // identity, so identity is read through refs rather than closed over.
  const userRef = useRef(user);
  userRef.current = user;
  const familyRef = useRef(currentFamily);
  familyRef.current = currentFamily;

  const clearWatch = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  const loadZones = useCallback(async (familyId: string): Promise<SafeZone[]> => {
    const cache = zonesRef.current;
    if (Date.now() - cache.at < ZONE_CACHE_MS) return cache.zones;

    const { data } = await supabase
      .from("safe_zones")
      .select("*")
      .eq("family_id", familyId);

    zonesRef.current = { zones: (data ?? []) as SafeZone[], at: Date.now() };
    return zonesRef.current.zones;
  }, []);

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
    let announced = false;

    watchIdRef.current = navigator.geolocation.watchPosition(
      async (position) => {
        const activeUser = userRef.current;
        const activeFamily = familyRef.current;
        if (!activeUser || !activeFamily) return;

        setStarting(false);
        setLocationSharing(true);

        const { latitude, longitude, speed: gpsSpeed, accuracy } = position.coords;
        const timestamp = new Date().toISOString();

        setFix({ lat: latitude, lng: longitude, accuracy, at: timestamp });

        let kmh = 0;
        if (gpsSpeed != null && gpsSpeed >= 0) {
          kmh = gpsSpeed * 3.6;
        } else if (lastPositionRef.current) {
          kmh = calculateSpeed(
            null,
            lastPositionRef.current.lat,
            lastPositionRef.current.lng,
            latitude,
            longitude,
            Date.now() - lastPositionRef.current.time
          );
        }

        setSpeed(kmh);
        const status = getActivityStatus(kmh);
        setActivity(status);

        const battery = await readBatteryLevel();
        setBatteryLevel(battery);

        try {
          const { error: insertError } = await supabase
            .from("location_history")
            .insert({
              user_id: activeUser.id,
              family_id: activeFamily.id,
              latitude,
              longitude,
              speed: kmh,
              accuracy,
              activity_status: status.label,
              battery_level: battery,
              created_at: timestamp,
            });
          if (insertError) throw insertError;

          const { error: profileError } = await supabase
            .from("profiles")
            .update({
              battery_level: battery,
              location_sharing_enabled: true,
              last_active: timestamp,
            })
            .eq("id", activeUser.id);
          if (profileError) throw profileError;

          setError(null);
        } catch (err) {
          console.error("Location write failed:", err);
          setError(
            err instanceof Error ? err.message : "Failed to save your location."
          );
        }

        if (!announced) {
          announced = true;
          await createAlert({
            familyId: activeFamily.id,
            userId: activeUser.id,
            type: "sharing_enabled",
            title: `${activeUser.name ?? "A family member"} started sharing location`,
            message: "Live location updates are now on.",
          });
        }

        // Advisory side-effects; these never block the location write.
        const zones = await loadZones(activeFamily.id);
        await evaluateSafeZones({
          familyId: activeFamily.id,
          userId: activeUser.id,
          userName: activeUser.name ?? "A family member",
          latitude,
          longitude,
          zones,
        });

        await checkLowBattery({
          familyId: activeFamily.id,
          userId: activeUser.id,
          userName: activeUser.name ?? "A family member",
          level: battery,
          previousLevel: lastBatteryRef.current,
        });
        lastBatteryRef.current = battery;

        lastPositionRef.current = { lat: latitude, lng: longitude, time: Date.now() };
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
  }, [clearWatch, loadZones, setLocationSharing]);

  const stop = useCallback(async () => {
    clearWatch();
    setStarting(false);
    setLocationSharing(false);
    setSpeed(0);
    setActivity(getActivityStatus(0));
    lastPositionRef.current = null;

    const activeUser = userRef.current;
    const activeFamily = familyRef.current;
    if (!activeUser || !activeFamily) return;

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ location_sharing_enabled: false })
      .eq("id", activeUser.id);

    if (updateError) {
      // The watch is already gone, so nothing new is being sent. Surface the
      // failure so the user knows the family's view may lag.
      setError(
        "Sharing stopped on this device, but we could not update your family. They will stop seeing you as live shortly."
      );
      return;
    }

    await createAlert({
      familyId: activeFamily.id,
      userId: activeUser.id,
      type: "sharing_disabled",
      title: `${activeUser.name ?? "A family member"} stopped sharing location`,
      message: "Live location updates have been turned off.",
    });
  }, [clearWatch, setLocationSharing]);

  // Reflect an externally-changed profile flag (e.g. the Settings toggle on
  // another device) by tearing down a watch that is no longer authorised.
  useEffect(() => {
    if (!locationSharingEnabled) clearWatch();
  }, [locationSharingEnabled, clearWatch]);

  // Best-effort: clear the stored flag when the sharing device goes away, so
  // the family is not left looking at a pin that says LIVE. An unload-time
  // request is not guaranteed to complete, which is exactly why presence is
  // *also* derived from fix recency in lib/presence.ts.
  useEffect(() => {
    const handlePageHide = () => {
      if (watchIdRef.current === null) return;
      const activeUser = userRef.current;
      if (!activeUser) return;
      void supabase
        .from("profiles")
        .update({ location_sharing_enabled: false })
        .eq("id", activeUser.id);
    };

    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, []);

  // Provider unmount means the signed-in app is gone (sign-out or navigation
  // away from /app), so release the hardware watch.
  useEffect(() => clearWatch, [clearWatch]);

  return (
    <LocationSharingContext.Provider
      value={{
        sharing: locationSharingEnabled,
        starting,
        error,
        clearError: () => setError(null),
        fix,
        speed,
        activity,
        batteryLevel,
        start,
        stop,
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
