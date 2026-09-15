"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Crosshair,
  Loader2,
  Trash2,
  AlertCircle,
  Search,
  MapPin,
  X,
} from "lucide-react";
import { searchPlaces, type GeocodeResult } from "@/lib/geocode";
import type { SafeZone } from "@/types";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full" />,
});

const PRESETS = ["Home", "School", "University", "Office", "Grandparents"];
const MIN_RADIUS = 50;
const MAX_RADIUS = 2000;

interface SafeZoneDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  familyId: string;
  /** Provided when editing; omitted when creating. */
  zone?: SafeZone | null;
  onSaved: () => void;
}

export default function SafeZoneDialog({
  open,
  onOpenChange,
  familyId,
  zone = null,
  onSaved,
}: SafeZoneDialogProps) {
  const isEditing = Boolean(zone);

  const [name, setName] = useState("");
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [radius, setRadius] = useState(200);
  const [notifyEntry, setNotifyEntry] = useState(true);
  const [notifyExit, setNotifyExit] = useState(true);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  // Reset the form whenever the dialog opens so a previous edit never leaks
  // into a subsequent create.
  useEffect(() => {
    if (!open) return;

    setError(null);
    setSearch("");
    setResults([]);
    setSearched(false);

    if (zone) {
      setName(zone.name);
      setPosition({ lat: zone.latitude, lng: zone.longitude });
      setRadius(zone.radius);
      setNotifyEntry(zone.notify_on_entry);
      setNotifyExit(zone.notify_on_exit);
    } else {
      setName("");
      setPosition(null);
      setRadius(200);
      setNotifyEntry(true);
      setNotifyExit(true);
    }
  }, [open, zone]);

  // Debounced place search. Nominatim asks for ~1 req/sec, and the abort
  // controller keeps a slow response from overwriting a newer query.
  useEffect(() => {
    const q = search.trim();
    if (q.length < 3) {
      setResults([]);
      setSearched(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const found = await searchPlaces(q, controller.signal);
        setResults(found);
        setSearched(true);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError(err instanceof Error ? err.message : "Search failed.");
        }
      } finally {
        setSearching(false);
      }
    }, 600);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search]);

  const chooseResult = (r: GeocodeResult) => {
    setPosition({ lat: r.latitude, lng: r.longitude });
    // Only auto-fill the name if the user hasn't typed one, so an explicit
    // "Home" is never overwritten by a long street address.
    if (!name.trim()) setName(r.label.split(",")[0].trim().slice(0, 60));
    setResults([]);
    setSearch("");
    setSearched(false);
  };

  // Not named `use...` on purpose: the react-hooks lint rule treats any
  // `use`-prefixed function as a Hook and rejects calling it from a callback.
  const detectCurrentLocation = useCallback(() => {
    setError(null);

    if (!("geolocation" in navigator)) {
      setError("This browser cannot access location.");
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied. Allow access or tap the map to place the zone."
            : "Could not get your location. Tap the map to place the zone instead."
        );
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }, []);

  // Creating a zone with no location yet: offer the user's position up front
  // so the map opens somewhere useful instead of at world view.
  useEffect(() => {
    if (open && !zone && !position) detectCurrentLocation();
  }, [open, zone, position, detectCurrentLocation]);

  const handleSave = async () => {
    setError(null);

    if (!name.trim()) {
      setError("Give the zone a name.");
      return;
    }
    if (!position) {
      setError("Pick a location by tapping the map or using your current location.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        family_id: familyId,
        name: name.trim(),
        latitude: position.lat,
        longitude: position.lng,
        radius,
        notify_on_entry: notifyEntry,
        notify_on_exit: notifyExit,
      };

      if (isEditing && zone) {
        const { error: err } = await supabase
          .from("safe_zones")
          .update(payload)
          .eq("id", zone.id);
        if (err) throw err;
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        const { error: err } = await supabase
          .from("safe_zones")
          .insert({ ...payload, created_by: user?.id ?? null });
        if (err) throw err;
      }

      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the zone.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!zone) return;

    setError(null);
    setDeleting(true);
    try {
      // safe_zone_states rows cascade via the zone_id foreign key.
      const { error: err } = await supabase
        .from("safe_zones")
        .delete()
        .eq("id", zone.id);
      if (err) throw err;

      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the zone.");
    } finally {
      setDeleting(false);
    }
  };

  const busy = saving || deleting;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit safe zone" : "New safe zone"}</DialogTitle>
          <DialogDescription>
            Family members get an alert when they arrive at or leave this place.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="zone-name">Name</Label>
            <Input
              id="zone-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Home"
              disabled={busy}
              maxLength={60}
            />
            <div className="flex flex-wrap gap-2 pt-1">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={busy}
                  onClick={() => setName(p)}
                  className="rounded-full border px-3 py-1 text-xs transition-colors hover:bg-accent disabled:opacity-50"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Location */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="zone-search">Location</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={detectCurrentLocation}
                disabled={busy || locating}
                className="h-8 gap-1.5"
              >
                {locating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Crosshair className="h-3.5 w-3.5" />
                )}
                Use my location
              </Button>
            </div>

            {/* Search */}
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="zone-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search an address or place"
                disabled={busy}
                className="pl-9 pr-9"
                autoComplete="off"
              />
              {(searching || search) && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2">
                  {searching ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setSearch("");
                        setResults([]);
                        setSearched(false);
                      }}
                      aria-label="Clear search"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </span>
              )}

              {results.length > 0 && (
                <ul
                  role="listbox"
                  aria-label="Search results"
                  className="absolute left-0 right-0 top-full z-10 mt-1 max-h-52 overflow-y-auto rounded-xl border bg-popover shadow-lg"
                >
                  {results.map((r) => (
                    <li key={r.id} role="option" aria-selected={false}>
                      <button
                        type="button"
                        onClick={() => chooseResult(r)}
                        className="flex w-full items-start gap-2 border-b px-3 py-2.5 text-left last:border-b-0 hover:bg-accent"
                      >
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span className="text-sm leading-snug">{r.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {searched && results.length === 0 && !searching && (
              <p className="text-xs text-muted-foreground">
                No matches. Try a broader search, or tap the map directly.
              </p>
            )}

            <div className="h-52 overflow-hidden rounded-xl border">
              <MapView
                className="h-full w-full"
                pickerMode
                pickerPosition={position}
                pickerRadius={radius}
                onPick={(lat, lng) => setPosition({ lat, lng })}
              />
            </div>

            <p className="text-xs text-muted-foreground">
              {position
                ? `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)} — tap or drag the pin to adjust.`
                : "Tap the map to place the zone."}
            </p>
          </div>

          {/* Radius */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="zone-radius">Radius</Label>
              <span className="text-sm font-medium text-muted-foreground">
                {radius} m
              </span>
            </div>
            <input
              id="zone-radius"
              type="range"
              min={MIN_RADIUS}
              max={MAX_RADIUS}
              step={25}
              value={radius}
              disabled={busy}
              onChange={(e) => setRadius(Number(e.target.value))}
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-primary disabled:opacity-50"
            />
            <p className="text-xs text-muted-foreground">
              Larger radii reduce false alerts from GPS drift. 150–300m suits most homes.
            </p>
          </div>

          {/* Notifications */}
          <div className="space-y-3 rounded-xl border p-3">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="notify-entry" className="font-normal">
                Alert on arrival
              </Label>
              <Switch
                id="notify-entry"
                checked={notifyEntry}
                onCheckedChange={setNotifyEntry}
                disabled={busy}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="notify-exit" className="font-normal">
                Alert on leaving
              </Label>
              <Switch
                id="notify-exit"
                checked={notifyExit}
                onCheckedChange={setNotifyExit}
                disabled={busy}
              />
            </div>
          </div>

          {error && (
            <div className="flex gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          {isEditing && (
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={busy}
              className="gap-2 sm:mr-auto"
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete
            </Button>
          )}
          <Button type="button" onClick={handleSave} disabled={busy} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEditing ? "Save changes" : "Create zone"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
