"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/lib/store";
import { useLocationSharing } from "@/lib/locationSharing";
import { getActivityStatus, getTimeAgo } from "@/lib/locationUtils";
import { presenceFor, PRESENCE_LABEL, type Presence } from "@/lib/presence";
import { getLocalTrack } from "@/lib/queue";
import { requestMediaSession } from "@/lib/mediaRequests";
import {
  analyseRoute,
  rangeStart,
  simplifyPath,
  type RangeKey,
  type RouteAnalysis,
  type RoutePoint,
} from "@/lib/routes";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import RouteSheet from "@/components/RouteSheet";
import type { MapMember, MapZone } from "@/components/MapView";
import type { SafeZone } from "@/types";
import {
  MapPin,
  Navigation,
  BatteryMedium,
  Clock,
  AlertCircle,
  Loader2,
  Crosshair,
  X,
  Gauge,
  Route,
  Video,
  Mic,
  UploadCloud,
} from "lucide-react";

// Leaflet touches `window` at import time, so it can never be server-rendered.
const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-none" />,
});

interface LocationRow {
  id: string;
  user_id: string;
  latitude: number;
  longitude: number;
  speed: number;
  accuracy: number;
  activity_status: string;
  battery_level: number | null;
  captured_offline: boolean | null;
  created_at: string;
  profiles: {
    name: string | null;
    avatar_url: string | null;
    location_sharing_enabled: boolean | null;
  } | null;
}

const PRESENCE_DOT: Record<Presence, string> = {
  live: "bg-primary",
  stale: "bg-amber-500",
  offline: "bg-muted-foreground/50",
};

/** Own recent track drawn by default, so an offline route is visible at once. */
const OWN_TRACK_WINDOW_MS = 2 * 60 * 60 * 1000;
/** Realtime bursts (a synced backlog) must not trigger a reload per row. */
const RELOAD_DEBOUNCE_MS = 800;
const PLAYBACK_TICK_MS = 400;

export default function MapPage() {
  const router = useRouter();
  const { user, currentFamily, focusMember, clearFocusMember } = useAppStore();
  const {
    sharing,
    starting,
    mode,
    statusLabel,
    online,
    pendingLocations,
    error: sharingError,
    clearError,
    fix,
    speed,
    activity,
    batteryLevel,
    start,
    stop,
  } = useLocationSharing();

  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [zones, setZones] = useState<SafeZone[]>([]);
  const [ownTrack, setOwnTrack] = useState<RoutePoint[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [followId, setFollowId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [requesting, setRequesting] = useState<"camera" | "audio" | null>(null);

  // Route inspection
  const [routeOpen, setRouteOpen] = useState(false);
  const [routeMemberId, setRouteMemberId] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>("today");
  const [routeAnalysis, setRouteAnalysis] = useState<RouteAnalysis | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [playbackIndex, setPlaybackIndex] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);

  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Timestamps and presence are time-derived, so re-render on a slow tick
  // rather than letting "8 seconds ago" freeze on screen.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  // ---- data loading -----------------------------------------------------
  const loadLocations = useCallback(async () => {
    if (!currentFamily) return;

    const { data, error: err } = await supabase
      .from("location_history")
      .select(
        "id, user_id, latitude, longitude, speed, accuracy, activity_status, battery_level, captured_offline, created_at, profiles(name, avatar_url, location_sharing_enabled)"
      )
      .eq("family_id", currentFamily.id)
      .order("created_at", { ascending: false })
      .limit(300);

    if (err) {
      // Offline reads fail routinely; the cached view stays on screen.
      if (navigator.onLine) setLoadError(err.message);
      return;
    }

    const rows = (data ?? []) as unknown as LocationRow[];

    const latest: LocationRow[] = [];
    for (const row of rows) {
      if (!latest.some((l) => l.user_id === row.user_id)) latest.push(row);
    }
    setLocations(latest);
    setLoadError(null);
  }, [currentFamily]);

  /**
   * The signed-in user's own recent path, merged from Supabase and the local
   * queue. The local half is what makes a route visible while still offline.
   */
  const loadOwnTrack = useCallback(async () => {
    if (!currentFamily || !user) return;
    const since = new Date(Date.now() - OWN_TRACK_WINDOW_MS).toISOString();

    const byId = new Map<string, RoutePoint>();

    const { data } = await supabase
      .from("location_history")
      .select(
        "id, latitude, longitude, speed, accuracy, activity_status, battery_level, captured_offline, created_at"
      )
      .eq("family_id", currentFamily.id)
      .eq("user_id", user.id)
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(1000);

    for (const row of data ?? []) {
      byId.set(row.id as string, {
        id: row.id as string,
        lat: row.latitude as number,
        lng: row.longitude as number,
        at: row.created_at as string,
        speed: (row.speed as number) ?? 0,
        accuracy: (row.accuracy as number) ?? 0,
        battery: (row.battery_level as number | null) ?? null,
        activity: (row.activity_status as string) ?? "Stationary",
        capturedOffline: Boolean(row.captured_offline),
      });
    }

    // Local points share the server id, so this de-duplicates cleanly.
    for (const point of await getLocalTrack(user.id, since)) {
      if (byId.has(point.local_id)) continue;
      byId.set(point.local_id, {
        id: point.local_id,
        lat: point.latitude,
        lng: point.longitude,
        at: point.recorded_at,
        speed: point.speed,
        accuracy: point.accuracy,
        battery: point.battery_level,
        activity: point.activity_status,
        capturedOffline: point.captured_offline === 1,
      });
    }

    setOwnTrack(
      [...byId.values()].sort((a, b) => a.at.localeCompare(b.at))
    );
  }, [currentFamily, user]);

  const loadZones = useCallback(async () => {
    if (!currentFamily) return;
    const { data } = await supabase
      .from("safe_zones")
      .select("*")
      .eq("family_id", currentFamily.id);
    if (data) setZones(data as SafeZone[]);
  }, [currentFamily]);

  useEffect(() => {
    if (!currentFamily) return;
    let active = true;

    (async () => {
      try {
        await Promise.all([loadLocations(), loadZones(), loadOwnTrack()]);
      } catch (err) {
        setLoadError(
          err instanceof Error ? err.message : "Could not load map data."
        );
      } finally {
        if (active) setLoading(false);
      }
    })();

    // Debounced: syncing a 200-point offline backlog fires 200 INSERT events,
    // and reloading once per event would hammer the database and the map.
    const scheduleReload = () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = setTimeout(() => {
        void loadLocations();
        void loadOwnTrack();
      }, RELOAD_DEBOUNCE_MS);
    };

    const channel = supabase
      .channel(`family-locations-${currentFamily.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "location_history",
          filter: `family_id=eq.${currentFamily.id}`,
        },
        scheduleReload
      )
      // Stopping sharing adds no location row, so presence would keep its
      // stored flag until it aged out. Start/stop both write an alert.
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "alerts",
          filter: `family_id=eq.${currentFamily.id}`,
        },
        scheduleReload
      )
      .subscribe();

    return () => {
      active = false;
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [currentFamily, loadLocations, loadZones, loadOwnTrack]);

  // Own local track also changes without any realtime event (offline capture).
  useEffect(() => {
    if (!sharing) return;
    const id = setInterval(() => void loadOwnTrack(), 20_000);
    return () => clearInterval(id);
  }, [sharing, loadOwnTrack]);

  // ---- derived view models ---------------------------------------------
  const mapMembers: MapMember[] = useMemo(
    () =>
      locations.map((l) => {
        const isMe = l.user_id === user?.id;
        return {
          user_id: l.user_id,
          name: l.profiles?.name || "Family member",
          avatar_url: l.profiles?.avatar_url,
          latitude: l.latitude,
          longitude: l.longitude,
          speed: l.speed,
          accuracy: l.accuracy,
          activity_status: l.activity_status,
          battery_level: l.battery_level,
          created_at: l.created_at,
          isMe,
          // Own presence comes from the live watcher in this tab, which is
          // authoritative; everyone else is judged on fix recency.
          presence: isMe
            ? presenceFor({ sharingEnabled: sharing, lastFixAt: l.created_at })
            : presenceFor({
                sharingEnabled: l.profiles?.location_sharing_enabled,
                lastFixAt: l.created_at,
              }),
        };
      }),
    [locations, user?.id, sharing]
  );

  const mapZones: MapZone[] = useMemo(
    () =>
      zones.map((z) => ({
        id: z.id,
        name: z.name,
        latitude: z.latitude,
        longitude: z.longitude,
        radius: z.radius,
      })),
    [zones]
  );

  const liveCount = mapMembers.filter((m) => m.presence === "live").length;
  const selected = mapMembers.find((m) => m.user_id === selectedId) ?? null;
  const error = sharingError ?? loadError;

  // Own recent path when no route is being inspected, otherwise the route.
  const segments = useMemo(() => {
    if (routeOpen && routeAnalysis) {
      return routeAnalysis.segments.map((s) => ({
        ...s,
        points: simplifyPath(s.points),
      }));
    }
    if (ownTrack.length < 2) return [];
    return analyseRoute(ownTrack).segments.map((s) => ({
      ...s,
      points: simplifyPath(s.points),
    }));
  }, [routeOpen, routeAnalysis, ownTrack]);

  const playbackPosition = useMemo(() => {
    if (!routeOpen || playbackIndex == null || !routeAnalysis) return null;
    const point = routeAnalysis.points[playbackIndex];
    return point ? { lat: point.lat, lng: point.lng } : null;
  }, [routeOpen, playbackIndex, routeAnalysis]);

  // ---- SOS "View location" ---------------------------------------------
  // Driven by the store rather than a query string: pushing /app?focus=… does
  // not remount this page when it is already the active route, so a URL-based
  // focus silently did nothing on the second attempt.
  useEffect(() => {
    if (!focusMember) return;
    setSelectedId(focusMember.userId);
    setFocusId(focusMember.userId);
    setShowDetails(true);
    setRouteOpen(false);
    clearFocusMember();

    // Release the focus prop once the map has acted on it, so requesting the
    // same member again is seen as a new instruction.
    const timer = setTimeout(() => setFocusId(null), 1200);
    return () => clearTimeout(timer);
  }, [focusMember, clearFocusMember]);

  // A followed member who drops off the map should not leave follow mode armed.
  useEffect(() => {
    if (followId && !mapMembers.some((m) => m.user_id === followId)) {
      setFollowId(null);
    }
  }, [followId, mapMembers]);

  // ---- route loading ----------------------------------------------------
  const loadRoute = useCallback(
    async (memberId: string, key: RangeKey) => {
      if (!currentFamily || !user) return;

      setRouteLoading(true);
      setRouteError(null);
      setPlaybackIndex(null);
      setPlaying(false);

      try {
        const since = rangeStart(key).toISOString();
        const byId = new Map<string, RoutePoint>();

        const { data, error: err } = await supabase
          .from("location_history")
          .select(
            "id, latitude, longitude, speed, accuracy, activity_status, battery_level, captured_offline, created_at"
          )
          .eq("family_id", currentFamily.id)
          .eq("user_id", memberId)
          .gte("created_at", since)
          .order("created_at", { ascending: true })
          .limit(2000);

        if (err) throw err;

        for (const row of data ?? []) {
          byId.set(row.id as string, {
            id: row.id as string,
            lat: row.latitude as number,
            lng: row.longitude as number,
            at: row.created_at as string,
            speed: (row.speed as number) ?? 0,
            accuracy: (row.accuracy as number) ?? 0,
            battery: (row.battery_level as number | null) ?? null,
            activity: (row.activity_status as string) ?? "Stationary",
            capturedOffline: Boolean(row.captured_offline),
          });
        }

        // Own route also includes anything still sitting in the local queue.
        if (memberId === user.id) {
          for (const point of await getLocalTrack(user.id, since)) {
            if (byId.has(point.local_id)) continue;
            byId.set(point.local_id, {
              id: point.local_id,
              lat: point.latitude,
              lng: point.longitude,
              at: point.recorded_at,
              speed: point.speed,
              accuracy: point.accuracy,
              battery: point.battery_level,
              activity: point.activity_status,
              capturedOffline: point.captured_offline === 1,
            });
          }
        }

        setRouteAnalysis(analyseRoute([...byId.values()], zones));
      } catch (err) {
        setRouteError(
          err instanceof Error ? err.message : "Could not load the route."
        );
        setRouteAnalysis(null);
      } finally {
        setRouteLoading(false);
      }
    },
    [currentFamily, user, zones]
  );

  useEffect(() => {
    if (!routeOpen || !routeMemberId) return;
    void loadRoute(routeMemberId, range);
  }, [routeOpen, routeMemberId, range, loadRoute]);

  // Playback timer
  useEffect(() => {
    if (!playing || !routeAnalysis || routeAnalysis.points.length < 2) return;

    const id = setInterval(() => {
      setPlaybackIndex((current) => {
        const next = (current ?? 0) + 1;
        if (next >= routeAnalysis.points.length) {
          setPlaying(false);
          return routeAnalysis.points.length - 1;
        }
        return next;
      });
    }, PLAYBACK_TICK_MS);

    return () => clearInterval(id);
  }, [playing, routeAnalysis]);

  // ---- actions ----------------------------------------------------------
  const handleStop = async () => {
    setStopping(true);
    try {
      await stop();
      setStopOpen(false);
    } finally {
      setStopping(false);
    }
  };

  const handleMediaRequest = async (kind: "camera" | "audio") => {
    if (!selected || !currentFamily || !user) return;

    setRequesting(kind);
    const { error: err } = await requestMediaSession({
      familyId: currentFamily.id,
      requesterId: user.id,
      targetId: selected.user_id,
      kind,
    });
    setRequesting(null);

    if (err) {
      setLoadError(err.message);
      return;
    }

    setNotice(
      `${kind === "camera" ? "Camera" : "Microphone"} request sent to ${selected.name}. It starts only if they approve.`
    );
    // The session lifecycle (consent, stream, timer) lives on the Safety tab.
    router.push("/app/safety");
  };

  const openRoute = (memberId: string) => {
    setRouteMemberId(memberId);
    setRouteOpen(true);
    setFollowId(null);
  };

  const routeMemberName =
    mapMembers.find((m) => m.user_id === routeMemberId)?.name ?? "Family member";

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="safe-top shrink-0 p-4 pb-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">Map</h1>
            <p className="truncate text-sm text-muted-foreground">
              {currentFamily?.name ?? "Loading..."}
            </p>
          </div>

          <div
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${
              mode === "live"
                ? "bg-primary/10 text-primary"
                : mode === "recording-offline"
                ? "bg-destructive/10 text-destructive"
                : mode === "syncing"
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-500"
                : "bg-secondary text-muted-foreground"
            }`}
            aria-live="polite"
          >
            <span
              className={`h-2 w-2 rounded-full ${
                mode === "live"
                  ? "animate-pulse bg-primary"
                  : mode === "recording-offline"
                  ? "animate-pulse bg-destructive"
                  : mode === "syncing"
                  ? "animate-pulse bg-amber-500"
                  : "bg-muted-foreground/60"
              }`}
            />
            {mode === "live" ? "LIVE" : statusLabel}
          </div>
        </div>

        {error && (
          <Card className="mb-3 border-destructive/30 bg-destructive/10 p-3">
            <div className="flex gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <p className="flex-1 text-sm text-destructive">{error}</p>
              <button
                type="button"
                onClick={() => {
                  clearError();
                  setLoadError(null);
                }}
                aria-label="Dismiss error"
                className="text-destructive/70 hover:text-destructive"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </Card>
        )}

        {notice && (
          <Card className="mb-3 border-primary/30 bg-primary/10 p-3">
            <p className="text-sm text-primary">{notice}</p>
          </Card>
        )}

        {(sharing || pendingLocations > 0) && fix && (
          <Card className="glass p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="text-3xl" aria-hidden="true">
                  {activity.icon}
                </span>
                <div className="min-w-0">
                  <div className="truncate font-semibold">{activity.label}</div>
                  <div className="text-sm text-muted-foreground">
                    {speed.toFixed(1)} km/h
                  </div>
                </div>
              </div>
              {sharing && (
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => setStopOpen(true)}
                >
                  Stop
                </Button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
                {fix.lat.toFixed(4)}, {fix.lng.toFixed(4)}
              </span>
              <span className="flex items-center gap-1.5">
                <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
                {getTimeAgo(fix.at)}
              </span>
              {batteryLevel != null && (
                <span className="flex items-center gap-1.5">
                  <BatteryMedium className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {batteryLevel}%
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <Crosshair className="h-4 w-4 shrink-0" aria-hidden="true" />
                ±{Math.round(fix.accuracy)}m
              </span>
              {pendingLocations > 0 && (
                <span className="col-span-2 flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-500">
                  <UploadCloud className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {pendingLocations} location{pendingLocations === 1 ? "" : "s"}{" "}
                  waiting to sync
                </span>
              )}
            </div>
          </Card>
        )}
      </div>

      {/* Map */}
      <div className="relative min-h-[240px] flex-1">
        {loading ? (
          <Skeleton className="h-full w-full rounded-none" />
        ) : (
          <MapView
            members={mapMembers}
            zones={mapZones}
            segments={segments}
            playbackPosition={playbackPosition}
            selectedUserId={selectedId}
            onSelectMember={(id) => {
              setSelectedId(id);
              setShowDetails(false);
              if (id === null) setRouteOpen(false);
            }}
            followUserId={followId}
            focusUserId={focusId}
            className="h-full w-full"
          />
        )}

        {!loading && mapMembers.length === 0 && (
          <div className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center p-6">
            <Card className="glass-strong pointer-events-auto max-w-xs p-6 text-center">
              <MapPin
                className="mx-auto mb-3 h-10 w-10 text-muted-foreground"
                aria-hidden="true"
              />
              <h3 className="mb-1 font-semibold">No locations yet</h3>
              <p className="text-sm text-muted-foreground">
                Start sharing to appear on the map. Family members who share
                will show up here too.
              </p>
            </Card>
          </div>
        )}

        {/* Route inspection */}
        {routeOpen && (
          <div className="absolute bottom-0 left-0 right-0 z-[600]">
            <RouteSheet
              memberName={routeMemberName}
              range={range}
              onRangeChange={setRange}
              analysis={routeAnalysis}
              loading={routeLoading}
              error={routeError}
              playbackIndex={playbackIndex}
              onPlaybackChange={setPlaybackIndex}
              playing={playing}
              onPlayingChange={setPlaying}
              onClose={() => {
                setRouteOpen(false);
                setPlaying(false);
                setPlaybackIndex(null);
              }}
            />
          </div>
        )}

        {/* Member detail sheet */}
        {selected && !routeOpen && (
          <div className="absolute bottom-3 left-3 right-3 z-[500]">
            <Card className="glass-strong p-4">
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold">
                      {selected.name}
                      {selected.isMe ? " (You)" : ""}
                    </span>
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        PRESENCE_DOT[selected.presence]
                      }`}
                      aria-hidden="true"
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {selected.presence === "live"
                      ? `Online · ${selected.activity_status}`
                      : `Last known location — ${getTimeAgo(selected.created_at)}`}
                    {selected.presence === "live" && selected.speed >= 2
                      ? ` · ${selected.speed.toFixed(0)} km/h`
                      : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  aria-label="Close member details"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                {selected.battery_level != null && (
                  <span className="flex items-center gap-1.5">
                    <BatteryMedium className="h-4 w-4" aria-hidden="true" />
                    {selected.battery_level}%
                  </span>
                )}
                <span className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4" aria-hidden="true" />
                  Updated {getTimeAgo(selected.created_at)}
                </span>
                {selected.presence !== "live" && (
                  <span className="font-medium text-amber-700 dark:text-amber-500">
                    {PRESENCE_LABEL[selected.presence]}
                  </span>
                )}
              </div>

              {showDetails && (
                <div className="mt-2 space-y-1 border-t pt-2 text-sm text-muted-foreground">
                  <p className="flex items-center gap-1.5">
                    <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {selected.latitude.toFixed(5)},{" "}
                    {selected.longitude.toFixed(5)}
                  </p>
                  <p className="flex items-center gap-1.5">
                    <Crosshair className="h-4 w-4 shrink-0" aria-hidden="true" />
                    Accuracy ±{Math.round(selected.accuracy)}m
                  </p>
                  <p className="flex items-center gap-1.5">
                    <Gauge className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {selected.speed.toFixed(1)} km/h · {selected.activity_status}
                  </p>
                </div>
              )}

              <div className="mt-3 grid grid-cols-3 gap-2">
                <Button
                  size="sm"
                  variant={followId === selected.user_id ? "default" : "outline"}
                  onClick={() =>
                    setFollowId(
                      followId === selected.user_id ? null : selected.user_id
                    )
                  }
                >
                  {followId === selected.user_id ? "Following" : "Follow"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => openRoute(selected.user_id)}
                >
                  <Route className="h-4 w-4" />
                  Route
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowDetails((v) => !v)}
                >
                  {showDetails ? "Less" : "Details"}
                </Button>

                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${selected.latitude},${selected.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="col-span-3"
                >
                  <Button size="sm" variant="outline" className="w-full gap-1.5">
                    <Navigation className="h-4 w-4" />
                    Navigate there
                  </Button>
                </a>

                {/* Consent-based: these only create a request. */}
                {!selected.isMe && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="col-span-3 gap-1.5 sm:col-span-1"
                      disabled={requesting !== null || !online}
                      onClick={() => handleMediaRequest("camera")}
                    >
                      {requesting === "camera" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Video className="h-4 w-4" />
                      )}
                      Ask for camera
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="col-span-3 gap-1.5 sm:col-span-1"
                      disabled={requesting !== null || !online}
                      onClick={() => handleMediaRequest("audio")}
                    >
                      {requesting === "audio" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Mic className="h-4 w-4" />
                      )}
                      Ask for mic
                    </Button>
                  </>
                )}
              </div>
            </Card>
          </div>
        )}
      </div>

      {/* Start sharing / member list */}
      <div className="glass-strong shrink-0 border-t p-4">
        {sharing ? (
          <Button
            onClick={() => setStopOpen(true)}
            size="lg"
            variant="outline"
            className="mb-3 w-full"
          >
            Stop location sharing
          </Button>
        ) : starting ? (
          // Acquiring a first fix can take 20s or fail silently indoors, so
          // this stays tappable: never trap the user in a pending state.
          <Button
            onClick={() => stop()}
            size="lg"
            variant="outline"
            className="mb-3 w-full gap-2"
          >
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            Getting your location... tap to cancel
          </Button>
        ) : (
          <Button
            onClick={start}
            size="lg"
            className="mb-3 w-full gap-2"
            disabled={!user || !currentFamily}
          >
            <Navigation className="h-5 w-5" aria-hidden="true" />
            Start location sharing
          </Button>
        )}

        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
          Sharing now ({liveCount})
        </h2>

        <div className="max-h-40 space-y-2 overflow-y-auto">
          {loading ? (
            <Skeleton className="h-14 w-full" />
          ) : mapMembers.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">
              Nobody is sharing their location right now.
            </p>
          ) : (
            mapMembers.map((m) => {
              const status = getActivityStatus(m.speed);
              return (
                <button
                  key={m.user_id}
                  type="button"
                  onClick={() => {
                    setSelectedId(m.user_id);
                    setFocusId(m.user_id);
                    setRouteOpen(false);
                    setShowDetails(false);
                  }}
                  className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors hover:bg-accent/50 ${
                    selectedId === m.user_id ? "border-primary" : "bg-card"
                  }`}
                >
                  <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-lg">
                    {status.icon}
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background ${
                        PRESENCE_DOT[m.presence]
                      }`}
                      aria-hidden="true"
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{m.name}</span>
                      {m.isMe && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                          You
                        </span>
                      )}
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                      {PRESENCE_LABEL[m.presence]} · {status.label} ·{" "}
                      {getTimeAgo(m.created_at)}
                    </p>
                  </div>
                  {m.battery_level != null && (
                    <span className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
                      <BatteryMedium className="h-4 w-4" aria-hidden="true" />
                      {m.battery_level}%
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Stop sharing confirmation */}
      <Dialog open={stopOpen} onOpenChange={(o) => !o && setStopOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stop sharing your location?</DialogTitle>
            <DialogDescription>
              Your family will no longer receive your live location. Anything
              already recorded stays in your history, and you can start sharing
              again at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setStopOpen(false)}
              disabled={stopping}
            >
              Keep sharing
            </Button>
            <Button
              variant="destructive"
              onClick={handleStop}
              disabled={stopping}
              className="gap-2"
            >
              {stopping && <Loader2 className="h-4 w-4 animate-spin" />}
              Stop sharing
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
