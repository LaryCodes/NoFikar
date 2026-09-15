"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/lib/store";
import { useLocationSharing } from "@/lib/locationSharing";
import { getTimeAgo } from "@/lib/locationUtils";
import { acknowledgeSos, closeSos } from "@/lib/sos";
import { Button } from "@/components/ui/button";
import {
  BatteryLow,
  MapPin,
  Clock,
  Loader2,
  ShieldCheck,
  WifiOff,
  Gauge,
  Navigation,
  UploadCloud,
} from "lucide-react";
import type { EmergencySession } from "@/types";

/**
 * Persistent emergency state, rendered above every screen in the signed-in app
 * so an SOS cannot be missed by switching tabs.
 *
 * Sender: "SOS ACTIVE" plus a way to confirm they are safe.
 * Receivers: the context the sender's device actually reported, with the
 * position honestly labelled live or last-known, and the actions that matter.
 *
 * An SOS raised offline is shown from local state and marked as not yet
 * delivered — the banner never implies the family has been reached.
 */
export default function SosBanner() {
  const router = useRouter();
  const { user, currentFamily, localSos, setLocalSos, focusOnMember } =
    useAppStore();
  const { setHighFrequency, online } = useLocationSharing();

  const [serverSessions, setServerSessions] = useState<EmergencySession[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const userName = user?.name || user?.email?.split("@")[0] || "A family member";

  const load = useCallback(async () => {
    if (!currentFamily) return;

    const { data, error: err } = await supabase
      .from("emergency_sessions")
      .select("*")
      .eq("family_id", currentFamily.id)
      .eq("session_type", "sos")
      .eq("status", "active")
      .order("created_at", { ascending: false });

    if (err) {
      // Offline reads fail routinely; that is not worth shouting about.
      if (navigator.onLine) setError(err.message);
      return;
    }
    setError(null);
    setServerSessions((data ?? []) as EmergencySession[]);
  }, [currentFamily]);

  useEffect(() => {
    if (!currentFamily) return;
    let active = true;

    load();

    supabase
      .from("family_members")
      .select("user_id, name")
      .eq("family_id", currentFamily.id)
      .then(({ data }) => {
        if (!active) return;
        const map: Record<string, string> = {};
        for (const row of data ?? []) map[row.user_id as string] = row.name as string;
        setNames(map);
      });

    const channel = supabase
      .channel(`sos-${currentFamily.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "emergency_sessions",
          filter: `family_id=eq.${currentFamily.id}`,
        },
        () => load()
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [currentFamily, load]);

  // Merge the locally-raised SOS with what the server knows, de-duplicated by
  // the shared client-generated id.
  const sessions = useMemo<EmergencySession[]>(() => {
    const serverIds = new Set(serverSessions.map((s) => s.id));
    if (!localSos || serverIds.has(localSos.id)) return serverSessions;

    return [
      {
        id: localSos.id,
        family_id: localSos.familyId,
        requester_id: user?.id ?? "",
        target_id: user?.id ?? "",
        session_type: "sos",
        status: "active",
        data: localSos.data,
        acknowledged_by: null,
        acknowledged_at: null,
        created_at: localSos.createdAt,
      },
      ...serverSessions,
    ];
  }, [localSos, serverSessions, user?.id]);

  // Reconcile local emergency state against the server.
  useEffect(() => {
    if (!localSos) return;
    const onServer = serverSessions.some((s) => s.id === localSos.id);

    if (onServer && localSos.queued) {
      setLocalSos({ ...localSos, queued: false });
      return;
    }
    // Delivered previously and no longer active server-side: it was closed.
    if (!onServer && !localSos.queued) setLocalSos(null);
  }, [localSos, serverSessions, setLocalSos]);

  // While the user's own SOS is active, tighten the location capture interval.
  const myEmergencyActive = sessions.some((s) => s.requester_id === user?.id);
  useEffect(() => {
    setHighFrequency(myEmergencyActive);
    return () => setHighFrequency(false);
  }, [myEmergencyActive, setHighFrequency]);

  // Re-render on a timer so "Updated 8 seconds ago" does not freeze.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (sessions.length === 0) return;
    const id = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(id);
  }, [sessions.length]);

  if (!user || sessions.length === 0) return null;

  const run = async (
    key: string,
    fn: () => Promise<{ error: Error | null }>,
    after?: () => void
  ) => {
    setBusy(key);
    setError(null);
    const { error: err } = await fn();
    if (err) setError(err.message);
    else {
      after?.();
      await load();
    }
    setBusy(null);
  };

  return (
    <div className="shrink-0 space-y-3 border-b border-red-500/40 bg-red-500/10 p-3">
      {error && <p className="text-xs text-destructive">{error}</p>}

      {sessions.map((session) => {
        const mine = session.requester_id === user.id;
        const who = mine ? "You" : names[session.requester_id] ?? "A family member";
        const ctx = session.data ?? {};
        const acknowledged = Boolean(session.acknowledged_at);
        const ackName = session.acknowledged_by
          ? names[session.acknowledged_by] ?? "Someone"
          : null;
        const notDelivered = mine && localSos?.id === session.id && localSos.queued;
        const hasPosition = ctx.latitude != null && ctx.longitude != null;

        return (
          <div key={session.id} className="space-y-2">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 text-lg leading-none" aria-hidden="true">
                🚨
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-red-700 dark:text-red-400">
                  {mine ? "SOS ACTIVE" : `SOS — ${who} needs help`}
                </p>

                <p className="text-xs text-red-700/80 dark:text-red-400/80">
                  {notDelivered
                    ? "Recorded on this device. Your family will be alerted as soon as you reconnect."
                    : mine
                    ? acknowledged
                      ? `Your family has been notified. ${ackName} is responding.`
                      : "Your family has been notified."
                    : acknowledged
                    ? `${ackName} is responding.`
                    : "Nobody has responded yet."}
                </p>

                {/* Only data the device actually reported. */}
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-red-700/90 dark:text-red-400/90">
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" aria-hidden="true" />
                    {!hasPosition
                      ? "Location unavailable"
                      : ctx.is_last_known
                      ? `Last known location${
                          ctx.fix_at ? ` — ${getTimeAgo(ctx.fix_at)}` : ""
                        }`
                      : "Location attached"}
                  </span>

                  {ctx.battery_level != null && (
                    <span className="flex items-center gap-1">
                      <BatteryLow className="h-3 w-3" aria-hidden="true" />
                      Battery {ctx.battery_level}%
                    </span>
                  )}

                  {ctx.activity_status && (
                    <span className="flex items-center gap-1">
                      <Gauge className="h-3 w-3" aria-hidden="true" />
                      {ctx.activity_status}
                      {ctx.speed != null && ctx.speed >= 2
                        ? ` · ${ctx.speed.toFixed(0)} km/h`
                        : ""}
                    </span>
                  )}

                  {ctx.online === false && (
                    <span className="flex items-center gap-1">
                      <WifiOff className="h-3 w-3" aria-hidden="true" />
                      Device was offline
                    </span>
                  )}

                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" aria-hidden="true" />
                    Triggered {getTimeAgo(session.created_at)}
                  </span>

                  {notDelivered && (
                    <span className="flex items-center gap-1 font-medium">
                      <UploadCloud className="h-3 w-3" aria-hidden="true" />
                      Waiting to sync
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {mine ? (
                <>
                  <Button
                    size="sm"
                    className="gap-1.5"
                    disabled={busy === session.id}
                    onClick={() =>
                      run(
                        session.id,
                        () =>
                          closeSos({
                            session,
                            userId: user.id,
                            userName,
                            outcome: "resolved",
                          }),
                        () => setLocalSos(null)
                      )
                    }
                  >
                    {busy === session.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-4 w-4" />
                    )}
                    I&apos;m safe
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === session.id}
                    onClick={() =>
                      run(
                        session.id,
                        () =>
                          closeSos({
                            session,
                            userId: user.id,
                            userName,
                            outcome: "ended",
                          }),
                        () => setLocalSos(null)
                      )
                    }
                  >
                    Cancel SOS
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      focusOnMember(session.requester_id);
                      router.push("/app");
                    }}
                  >
                    <MapPin className="h-4 w-4" />
                    View location
                  </Button>

                  {hasPosition && (
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${ctx.latitude},${ctx.longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button size="sm" variant="outline" className="gap-1.5">
                        <Navigation className="h-4 w-4" />
                        Navigate
                      </Button>
                    </a>
                  )}

                  {!acknowledged && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === session.id || !online}
                      className="gap-1.5"
                      onClick={() =>
                        run(session.id, () =>
                          acknowledgeSos({
                            session,
                            userId: user.id,
                            userName,
                          })
                        )
                      }
                    >
                      {busy === session.id && (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      )}
                      Acknowledge
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
