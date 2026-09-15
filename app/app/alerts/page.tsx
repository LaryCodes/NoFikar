"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/lib/store";
import { useLocationSharing } from "@/lib/locationSharing";
import { ALERT_META, type AlertType } from "@/lib/alerts";
import { getTimeAgo } from "@/lib/locationUtils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SkeletonList } from "@/components/ui/skeleton";
import PullToRefresh from "@/components/PullToRefresh";
import {
  Bell,
  Clock,
  AlertCircle,
  CheckCheck,
  MapPin,
  Navigation,
  UploadCloud,
} from "lucide-react";

interface AlertRow {
  id: string;
  type: string;
  title: string;
  message: string | null;
  data: Record<string, unknown> | null;
  read: boolean;
  created_at: string;
  user_id: string | null;
  profiles: { name: string | null; avatar_url: string | null } | null;
}

/** Coordinates are only present on alerts that actually captured a position. */
function coordsOf(alert: AlertRow): { lat: number; lng: number } | null {
  const lat = alert.data?.latitude;
  const lng = alert.data?.longitude;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return { lat, lng };
}

const FILTERS = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "sos", label: "Emergency" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

export default function AlertsPage() {
  const router = useRouter();
  const { currentFamily, focusOnMember } = useAppStore();
  const { pendingEvents } = useLocationSharing();

  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [marking, setMarking] = useState(false);

  const load = useCallback(async () => {
    if (!currentFamily) return;

    const { data, error: err } = await supabase
      .from("alerts")
      .select(
        "id, type, title, message, data, read, created_at, user_id, profiles(name, avatar_url)"
      )
      .eq("family_id", currentFamily.id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (err) {
      setError(err.message);
      return;
    }

    setError(null);
    setAlerts((data ?? []) as unknown as AlertRow[]);
  }, [currentFamily]);

  useEffect(() => {
    if (!currentFamily) return;
    let active = true;

    (async () => {
      try {
        await load();
      } finally {
        if (active) setLoading(false);
      }
    })();

    const channel = supabase
      .channel(`family-alerts-${currentFamily.id}`)
      .on(
        "postgres_changes",
        {
          // Covers both new alerts and read-state changes from other devices.
          event: "*",
          schema: "public",
          table: "alerts",
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

  const unreadCount = alerts.filter((a) => !a.read).length;

  const markAllRead = async () => {
    if (!currentFamily || unreadCount === 0) return;

    setMarking(true);
    const previous = alerts;
    setAlerts((prev) => prev.map((a) => ({ ...a, read: true }))); // optimistic

    const { error: err } = await supabase
      .from("alerts")
      .update({ read: true })
      .eq("family_id", currentFamily.id)
      .eq("read", false);

    if (err) {
      setAlerts(previous); // roll back
      setError(err.message);
    }
    setMarking(false);
  };

  const markRead = async (alert: AlertRow) => {
    if (alert.read) return;
    setAlerts((prev) =>
      prev.map((a) => (a.id === alert.id ? { ...a, read: true } : a))
    );
    const { error: err } = await supabase
      .from("alerts")
      .update({ read: true })
      .eq("id", alert.id);
    if (err) {
      setAlerts((prev) =>
        prev.map((a) => (a.id === alert.id ? { ...a, read: false } : a))
      );
    }
  };

  const viewOnMap = (alert: AlertRow) => {
    if (!alert.user_id) return;
    void markRead(alert);
    focusOnMember(alert.user_id);
    router.push("/app");
  };

  const visible = alerts.filter((a) => {
    if (filter === "unread") return !a.read;
    if (filter === "sos") return a.type === "sos" || a.type === "help";
    return true;
  });

  const emptyCopy: Record<FilterKey, string> = {
    all: "Alerts appear here when family members trigger an SOS, arrive at or leave a safe zone, or run low on battery.",
    unread: "You're all caught up.",
    sos: "No emergency alerts. That's good news.",
  };

  return (
    <PullToRefresh onRefresh={load}>
      <div className="safe-top space-y-4 p-4">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Alerts</h1>
            <p className="text-sm text-muted-foreground">
              {loading
                ? "Loading..."
                : unreadCount > 0
                ? `${unreadCount} unread`
                : "All caught up"}
            </p>
          </div>

          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={markAllRead}
              disabled={marking}
              className="shrink-0 gap-1.5"
            >
              <CheckCheck className="h-4 w-4" />
              Mark read
            </Button>
          )}
        </header>

        {error && (
          <Card className="border-destructive/30 bg-destructive/10 p-3">
            <div className="flex gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          </Card>
        )}

        {/* Honest about anything raised offline that has not reached the family
            yet — the feed below only shows what the server actually has. */}
        {pendingEvents > 0 && (
          <Card className="border-amber-500/30 bg-amber-500/10 p-3">
            <div className="flex gap-2">
              <UploadCloud className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
              <p className="text-sm text-amber-700 dark:text-amber-400">
                {pendingEvents} safety {pendingEvents === 1 ? "event" : "events"}{" "}
                recorded on this device are still waiting to sync. Your family
                cannot see them yet.
              </p>
            </div>
          </Card>
        )}

        {/* Filters */}
        <div
          className="flex gap-2"
          role="tablist"
          aria-label="Filter alerts"
        >
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(f.key)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-accent"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {loading ? (
          <SkeletonList count={4} />
        ) : visible.length === 0 ? (
          <Card className="p-10 text-center">
            <Bell className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
            <h2 className="mb-1 font-semibold">
              {filter === "all" ? "No alerts yet" : "Nothing here"}
            </h2>
            <p className="text-sm text-muted-foreground">{emptyCopy[filter]}</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {visible.map((alert) => {
              const meta = ALERT_META[alert.type as AlertType];
              const who = alert.profiles?.name;
              const coords = coordsOf(alert);
              const isEmergency = alert.type === "sos" || alert.type === "help";

              return (
                <Card
                  key={alert.id}
                  className={`p-4 ${
                    !alert.read
                      ? isEmergency
                        ? "border-destructive/40 bg-destructive/5"
                        : "border-primary/40 bg-primary/5"
                      : ""
                  }`}
                >
                  <div className="flex gap-3">
                    <span className="text-2xl leading-none" aria-hidden="true">
                      {meta?.icon ?? "📢"}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-semibold">{alert.title}</h3>
                        {!alert.read && (
                          <button
                            type="button"
                            onClick={() => void markRead(alert)}
                            aria-label="Mark as read"
                            className="mt-1 h-3 w-3 shrink-0 rounded-full bg-primary"
                          />
                        )}
                      </div>

                      {alert.message && (
                        <p className="mt-1 text-sm text-muted-foreground">
                          {alert.message}
                        </p>
                      )}

                      <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {getTimeAgo(alert.created_at)}
                        </span>
                        <span>
                          ·{" "}
                          {new Date(alert.created_at).toLocaleString([], {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                        {meta && <span>· {meta.label}</span>}
                        {who && <span>· {who}</span>}
                      </p>

                      {/* Actions only appear when the data behind them exists. */}
                      {(coords || alert.user_id) && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {alert.user_id && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 gap-1.5"
                              onClick={() => viewOnMap(alert)}
                            >
                              <MapPin className="h-3.5 w-3.5" />
                              View on map
                            </Button>
                          )}
                          {coords && (
                            <a
                              href={`https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 gap-1.5"
                              >
                                <Navigation className="h-3.5 w-3.5" />
                                Navigate
                              </Button>
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        <div className="h-4" />
      </div>
    </PullToRefresh>
  );
}
