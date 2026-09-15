"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/lib/store";
import { useLocationSharing } from "@/lib/locationSharing";
import { getActivityStatus, getTimeAgo } from "@/lib/locationUtils";
import { presenceFor, PRESENCE_LABEL, type Presence } from "@/lib/presence";
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

export default function MapPage() {
  const { user, currentFamily } = useAppStore();
  const {
    sharing,
    starting,
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
  const [trail, setTrail] = useState<Array<{ lat: number; lng: number }>>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [followId, setFollowId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);
  const [stopping, setStopping] = useState(false);

  // Timestamps and presence are time-derived, so re-render on a slow tick
  // rather than letting "8 seconds ago" freeze on screen.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  // `?focus=<userId>` comes from the SOS banner's "View location" action.
  // Read from the URL directly instead of useSearchParams(), which would force
  // this route out of static prerendering.
  useEffect(() => {
    const target = new URLSearchParams(window.location.search).get("focus");
    if (!target) return;
    setFocusId(target);
    setSelectedId(target);
  }, []);

  // ---- data loading -----------------------------------------------------
  const loadLocations = useCallback(async () => {
    if (!currentFamily) return;

    const { data, error: err } = await supabase
      .from("location_history")
      .select(
        "id, user_id, latitude, longitude, speed, accuracy, activity_status, battery_level, created_at, profiles(name, avatar_url, location_sharing_enabled)"
      )
      .eq("family_id", currentFamily.id)
      .order("created_at", { ascending: false })
      .limit(300);

    if (err) {
      setLoadError(err.message);
      return;
    }

    const rows = (data ?? []) as unknown as LocationRow[];

    // Latest row per member.
    const latest: LocationRow[] = [];
    for (const row of rows) {
      if (!latest.some((l) => l.user_id === row.user_id)) latest.push(row);
    }
    setLocations(latest);
    setLoadError(null);

    // Movement history for the signed-in user, oldest -> newest.
    if (user) {
      setTrail(
        rows
          .filter((r) => r.user_id === user.id)
          .slice(0, 40)
          .reverse()
          .map((r) => ({ lat: r.latitude, lng: r.longitude }))
      );
    }
  }, [currentFamily, user]);

  const loadZones = useCallback(async () => {
    if (!currentFamily) return;
    const { data } = await supabase
      .from("safe_zones")
      .select("*")
      .eq("family_id", currentFamily.id);
    setZones((data ?? []) as SafeZone[]);
  }, [currentFamily]);

  useEffect(() => {
    if (!currentFamily) return;
    let active = true;

    (async () => {
      try {
        await Promise.all([loadLocations(), loadZones()]);
      } catch (err) {
        setLoadError(
          err instanceof Error ? err.message : "Could not load map data."
        );
      } finally {
        if (active) setLoading(false);
      }
    })();

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
        () => {
          loadLocations();
        }
      )
      // Stopping sharing adds no location row, so the pin would keep its
      // stored flag until it aged out. Stop/start both write an alert, so
      // piggy-backing on that refreshes presence immediately. Alerts are rare,
      // unlike profile updates which fire on every single GPS ping.
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "alerts",
          filter: `family_id=eq.${currentFamily.id}`,
        },
        () => {
          loadLocations();
        }
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [currentFamily, loadLocations, loadZones]);

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

  // A followed member who drops off the map should not leave follow mode armed.
  useEffect(() => {
    if (followId && !mapMembers.some((m) => m.user_id === followId)) {
      setFollowId(null);
    }
  }, [followId, mapMembers]);

  const handleStop = async () => {
    setStopping(true);
    try {
      await stop();
      setStopOpen(false);
    } finally {
      setStopping(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="safe-top shrink-0 p-4 pb-3">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Map</h1>
            <p className="text-sm text-muted-foreground">
              {currentFamily?.name ?? "Loading..."}
            </p>
          </div>

          <div
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ${
              sharing
                ? "bg-primary/10 text-primary"
                : "bg-secondary text-muted-foreground"
            }`}
            aria-live="polite"
          >
            <span
              className={`h-2 w-2 rounded-full ${
                sharing ? "animate-pulse bg-primary" : "bg-muted-foreground/60"
              }`}
            />
            {sharing ? "LIVE" : "Sharing off"}
          </div>
        </div>

        {error && (
          <Card className="mb-3 border-destructive/30 bg-destructive/10 p-3">
            <div className="flex gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <p className="flex-1 text-sm text-destructive">{error}</p>
              {sharingError && (
                <button
                  type="button"
                  onClick={clearError}
                  aria-label="Dismiss error"
                  className="text-destructive/70 hover:text-destructive"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </Card>
        )}

        {sharing && fix && (
          <Card className="glass p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-3xl" aria-hidden="true">
                  {activity.icon}
                </span>
                <div>
                  <div className="font-semibold">{activity.label}</div>
                  <div className="text-sm text-muted-foreground">
                    {speed.toFixed(1)} km/h
                  </div>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStopOpen(true)}
              >
                Stop sharing
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <MapPin className="h-4 w-4" aria-hidden="true" />
                {fix.lat.toFixed(4)}, {fix.lng.toFixed(4)}
              </span>
              <span className="flex items-center gap-1.5">
                <Clock className="h-4 w-4" aria-hidden="true" />
                {getTimeAgo(fix.at)}
              </span>
              {batteryLevel != null && (
                <span className="flex items-center gap-1.5">
                  <BatteryMedium className="h-4 w-4" aria-hidden="true" />
                  {batteryLevel}%
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <Crosshair className="h-4 w-4" aria-hidden="true" />
                ±{Math.round(fix.accuracy)}m
              </span>
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
            trail={trail}
            selectedUserId={selectedId}
            onSelectMember={(id) => {
              setSelectedId(id);
              setShowDetails(false);
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

        {/* Member detail sheet */}
        {selected && (
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
                    {PRESENCE_LABEL[selected.presence]} ·{" "}
                    {selected.activity_status}
                    {selected.speed >= 2
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
              </div>

              {showDetails && (
                <div className="mt-2 space-y-1 border-t pt-2 text-sm text-muted-foreground">
                  <p className="flex items-center gap-1.5">
                    <MapPin className="h-4 w-4" aria-hidden="true" />
                    {selected.latitude.toFixed(5)},{" "}
                    {selected.longitude.toFixed(5)}
                  </p>
                  <p className="flex items-center gap-1.5">
                    <Crosshair className="h-4 w-4" aria-hidden="true" />
                    Accuracy ±{Math.round(selected.accuracy)}m
                  </p>
                  <p className="flex items-center gap-1.5">
                    <Gauge className="h-4 w-4" aria-hidden="true" />
                    {selected.speed.toFixed(1)} km/h
                  </p>
                </div>
              )}

              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant={followId === selected.user_id ? "default" : "outline"}
                  className="flex-1"
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
                  className="flex-1"
                  onClick={() => setShowDetails((v) => !v)}
                >
                  {showDetails ? "Hide details" : "Details"}
                </Button>
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
                    setFocusId(null);
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
              Your family will no longer receive your live location. You can
              start sharing again at any time.
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
