"use client";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RANGE_LABELS,
  formatClock,
  formatDistance,
  formatDuration,
  type RangeKey,
  type RouteAnalysis,
  type TimelineKind,
} from "@/lib/routes";
import {
  X,
  Play,
  Pause,
  MapPin,
  Flag,
  Pause as PauseIcon,
  WifiOff,
  CircleSlash,
  DoorOpen,
  Navigation,
} from "lucide-react";

const KIND_ICON: Record<TimelineKind, typeof MapPin> = {
  start: Flag,
  stop: PauseIcon,
  zone_enter: MapPin,
  zone_exit: DoorOpen,
  offline: WifiOff,
  gap: CircleSlash,
  latest: Navigation,
};

const KIND_TONE: Record<TimelineKind, string> = {
  start: "text-primary",
  stop: "text-muted-foreground",
  zone_enter: "text-primary",
  zone_exit: "text-blue-600 dark:text-blue-400",
  offline: "text-amber-600 dark:text-amber-500",
  gap: "text-muted-foreground",
  latest: "text-primary",
};

const RANGES: RangeKey[] = ["today", "24h", "7d"];

interface Props {
  memberName: string;
  range: RangeKey;
  onRangeChange: (range: RangeKey) => void;
  analysis: RouteAnalysis | null;
  loading: boolean;
  error: string | null;
  playbackIndex: number | null;
  onPlaybackChange: (index: number | null) => void;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  onClose: () => void;
}

/**
 * Route inspection and playback for one family member.
 *
 * Every figure here is computed from stored GPS points (see lib/routes.ts).
 * Gaps in the record are shown as gaps, and offline stretches are labelled as
 * recovered rather than being quietly blended into a continuous journey.
 */
export default function RouteSheet({
  memberName,
  range,
  onRangeChange,
  analysis,
  loading,
  error,
  playbackIndex,
  onPlaybackChange,
  playing,
  onPlayingChange,
  onClose,
}: Props) {
  const summary = analysis?.summary;
  const points = analysis?.points ?? [];
  const canPlay = points.length >= 2;

  return (
    <div className="flex max-h-[70vh] flex-col overflow-hidden rounded-t-2xl border-t bg-background shadow-2xl">
      {/* Header */}
      <div className="flex shrink-0 items-start justify-between gap-3 border-b p-4 pb-3">
        <div className="min-w-0">
          <h2 className="truncate font-semibold">{memberName}&apos;s route</h2>
          <p className="text-sm text-muted-foreground">
            {loading
              ? "Loading recorded positions…"
              : summary && summary.points > 0
              ? `${summary.points} recorded ${
                  summary.points === 1 ? "point" : "points"
                }${
                  summary.offlinePoints > 0
                    ? ` · ${summary.offlinePoints} offline`
                    : ""
                }`
              : "No recorded positions in this period"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close route"
          className="shrink-0 rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Range picker */}
      <div className="flex shrink-0 gap-2 px-4 py-3" role="tablist" aria-label="Route period">
        {RANGES.map((key) => {
          const active = range === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onRangeChange(key)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-accent"
              }`}
            >
              {RANGE_LABELS[key]}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {error && (
          <p className="mb-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : !summary || summary.points === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nothing was recorded in this period. Positions are only stored while
            location sharing is on.
          </p>
        ) : (
          <>
            {/* Stats */}
            <dl className="mb-4 grid grid-cols-3 gap-2 text-center">
              {[
                { label: "Distance", value: formatDistance(summary.distanceM) },
                { label: "Tracked", value: formatDuration(summary.durationMs) },
                { label: "Moving", value: formatDuration(summary.movingMs) },
                { label: "Stationary", value: formatDuration(summary.stationaryMs) },
                {
                  label: "Offline",
                  value:
                    summary.offlineMs > 0
                      ? formatDuration(summary.offlineMs)
                      : "None",
                },
                { label: "Points", value: String(summary.points) },
              ].map((stat) => (
                <div key={stat.label} className="rounded-xl border p-2">
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {stat.label}
                  </dt>
                  <dd className="mt-0.5 text-sm font-semibold">{stat.value}</dd>
                </div>
              ))}
            </dl>

            {/* Playback */}
            {canPlay && (
              <div className="mb-4 rounded-xl border p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">Playback</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {playbackIndex != null && points[playbackIndex]
                      ? formatClock(points[playbackIndex].at)
                      : summary.startAt
                      ? formatClock(summary.startAt)
                      : "--:--"}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label={playing ? "Pause playback" : "Play route"}
                    onClick={() => {
                      if (playbackIndex == null) onPlaybackChange(0);
                      onPlayingChange(!playing);
                    }}
                  >
                    {playing ? (
                      <Pause className="h-4 w-4" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </Button>

                  <input
                    type="range"
                    min={0}
                    max={points.length - 1}
                    step={1}
                    value={playbackIndex ?? 0}
                    aria-label="Scrub route"
                    onChange={(e) => {
                      onPlayingChange(false);
                      onPlaybackChange(Number(e.target.value));
                    }}
                    className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-secondary accent-primary"
                  />
                </div>
              </div>
            )}

            {/* Timeline */}
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
              Timeline
            </h3>
            <ol className="space-y-2">
              {analysis?.timeline.map((entry) => {
                const Icon = KIND_ICON[entry.kind];
                return (
                  <li
                    key={entry.id}
                    className="flex gap-3 rounded-xl border p-3"
                  >
                    <Icon
                      className={`mt-0.5 h-4 w-4 shrink-0 ${KIND_TONE[entry.kind]}`}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        <span className="text-muted-foreground">
                          {formatClock(entry.at)}
                          {entry.endAt && entry.endAt !== entry.at
                            ? ` – ${formatClock(entry.endAt)}`
                            : ""}
                        </span>{" "}
                        {entry.label}
                      </p>
                      {entry.detail && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {entry.detail}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}
