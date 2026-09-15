"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/lib/store";
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
} from "lucide-react";
import type { EmergencySession } from "@/types";

/**
 * Persistent emergency state, rendered above every screen in the signed-in app
 * so an SOS cannot be missed by navigating to another tab.
 *
 * Sender sees "SOS ACTIVE" with a way to confirm they are safe.
 * Receivers see the context the sender's device actually reported, plus the
 * actions that matter: focus the map on them, or acknowledge.
 */
export default function SosBanner() {
  const router = useRouter();
  const { user, currentFamily } = useAppStore();

  const [sessions, setSessions] = useState<EmergencySession[]>([]);
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
      setError(err.message);
      return;
    }
    setError(null);
    setSessions((data ?? []) as EmergencySession[]);
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

  // Re-render on a timer so "Updated 8 seconds ago" does not freeze.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (sessions.length === 0) return;
    const id = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(id);
  }, [sessions.length]);

  if (!user || sessions.length === 0) return null;

  const run = async (key: string, fn: () => Promise<{ error: Error | null }>) => {
    setBusy(key);
    setError(null);
    const { error: err } = await fn();
    if (err) setError(err.message);
    else await load();
    setBusy(null);
  };

  return (
    <div className="shrink-0 space-y-2 border-b border-red-500/40 bg-red-500/10 p-3">
      {error && <p className="text-xs text-destructive">{error}</p>}

      {sessions.map((session) => {
        const mine = session.requester_id === user.id;
        const who = names[session.requester_id] ?? "A family member";
        const ctx = session.data ?? {};
        const acknowledged = Boolean(session.acknowledged_at);
        const ackName = session.acknowledged_by
          ? names[session.acknowledged_by] ?? "Someone"
          : null;

        return (
          <div key={session.id} className="space-y-2">
            <div className="flex items-start gap-2">
              <span
                className="mt-0.5 text-lg leading-none"
                aria-hidden="true"
              >
                🚨
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-red-700 dark:text-red-400">
                  {mine ? "SOS ACTIVE" : `SOS — ${who} needs help`}
                </p>

                <p className="text-xs text-red-700/80 dark:text-red-400/80">
                  {mine
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
                    {ctx.latitude != null
                      ? "Location available"
                      : "Location unavailable"}
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
                      Device offline
                    </span>
                  )}

                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" aria-hidden="true" />
                    Triggered {getTimeAgo(session.created_at)}
                  </span>
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
                      run(session.id, () =>
                        closeSos({
                          session,
                          userId: user.id,
                          userName,
                          outcome: "resolved",
                        })
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
                      run(session.id, () =>
                        closeSos({
                          session,
                          userId: user.id,
                          userName,
                          outcome: "ended",
                        })
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
                    disabled={ctx.latitude == null}
                    onClick={() =>
                      router.push(`/app?focus=${session.requester_id}`)
                    }
                  >
                    <MapPin className="h-4 w-4" />
                    View location
                  </Button>
                  {!acknowledged && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === session.id}
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
