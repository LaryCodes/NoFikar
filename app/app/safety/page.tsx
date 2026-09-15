"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/lib/store";
import { createAlert } from "@/lib/alerts";
import { triggerSos } from "@/lib/sos";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton, SkeletonList } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import SafeZoneDialog from "@/components/SafeZoneDialog";
import PullToRefresh from "@/components/PullToRefresh";
import EmergencySessions from "@/components/EmergencySessions";
import {
  AlertCircle,
  MapPin,
  Plus,
  Shield,
  Pencil,
  Phone,
  Trash2,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import type { SafeZone, EmergencyContact } from "@/types";

/** Grace period so a pocket press does not alarm the whole family. */
const SOS_COUNTDOWN_SECONDS = 5;

/** Best-effort current position; SOS must still fire without it. */
function getPosition(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

export default function SafetyPage() {
  const { currentFamily, user, localSos, setLocalSos } = useAppStore();

  const [zones, setZones] = useState<SafeZone[]>([]);
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [familyMembers, setFamilyMembers] = useState<
    Array<{ user_id: string; name: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [sosBusy, setSosBusy] = useState(false);
  /** Non-null while the accidental-press countdown is running. */
  const [sosCountdown, setSosCountdown] = useState<number | null>(null);
  const [sosActive, setSosActive] = useState(false);
  const [actionBusy, setActionBusy] = useState<"safe" | "help" | null>(null);

  const [zoneDialogOpen, setZoneDialogOpen] = useState(false);
  const [editingZone, setEditingZone] = useState<SafeZone | null>(null);

  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactRelation, setContactRelation] = useState("");
  const [contactSaving, setContactSaving] = useState(false);

  const userName = user?.name || user?.email?.split("@")[0] || "Family member";

  const load = useCallback(async () => {
    if (!currentFamily || !user) return;

    try {
    const [zoneRes, contactRes, memberRes, sosRes] = await Promise.all([
      supabase
        .from("safe_zones")
        .select("*")
        .eq("family_id", currentFamily.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("emergency_contacts")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("family_members")
        .select("user_id, name, profiles(name)")
        .eq("family_id", currentFamily.id),
      // Is one of MY SOS sessions still open? Guards against stacking a second
      // emergency on top of an unresolved one.
      supabase
        .from("emergency_sessions")
        .select("id")
        .eq("family_id", currentFamily.id)
        .eq("session_type", "sos")
        .eq("requester_id", user.id)
        .eq("status", "active")
        .limit(1),
    ]);

    if (!sosRes.error) setSosActive((sosRes.data ?? []).length > 0);

    if (zoneRes.error) setError(zoneRes.error.message);
    else setZones((zoneRes.data ?? []) as SafeZone[]);

    if (!contactRes.error) {
      setContacts((contactRes.data ?? []) as EmergencyContact[]);
    }

    if (!memberRes.error) {
      setFamilyMembers(
        (memberRes.data ?? []).map((m) => {
          // PostgREST types embedded relations as arrays even for to-one
          // relationships, so normalise before reading.
          const embed = m.profiles as unknown;
          const profile = (Array.isArray(embed) ? embed[0] : embed) as
            | { name: string | null }
            | null
            | undefined;

          return {
            user_id: m.user_id as string,
            name: profile?.name || (m.name as string) || "Family member",
          };
        })
      );
    }
    } catch (err) {
      // Without this the page would sit on skeletons forever, because the
      // caller's setLoading(false) never runs on a rejected promise.
      setError(
        err instanceof Error ? err.message : "Could not load safety data."
      );
    }
  }, [currentFamily, user]);

  useEffect(() => {
    if (!currentFamily || !user) return;
    let active = true;
    (async () => {
      try {
        await load();
      } finally {
        if (active) setLoading(false);
      }
    })();

    // Keeps the SOS button state in step when the emergency is resolved from
    // the banner (possibly on another device).
    const channel = supabase
      .channel(`safety-sessions-${currentFamily.id}`)
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
  }, [currentFamily, user, load]);

  // Auto-dismiss transient confirmations.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  /**
   * Shared path for the lightweight "I'm safe" / "Need help" check-ins.
   * A full SOS goes through triggerSos() instead, because it needs an
   * emergency session rather than a one-off alert.
   */
  const sendSignal = async (
    type: "safe" | "help",
    title: string,
    message: string
  ) => {
    if (!user || !currentFamily) {
      setError("Still loading your profile. Try again in a moment.");
      return;
    }

    setError(null);

    const { error: alertError } = await createAlert({
      familyId: currentFamily.id,
      userId: user.id,
      type,
      title,
      message,
    });

    if (alertError) {
      setError(alertError.message || "Could not send the alert.");
      return;
    }

    // Attach a location ping so the family can see where the signal came from.
    const pos = await getPosition();
    if (pos) {
      await supabase.from("location_history").insert({
        user_id: user.id,
        family_id: currentFamily.id,
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        speed: 0,
        accuracy: pos.coords.accuracy,
        activity_status: "Stationary",
      });
    }

    setNotice(
      pos
        ? "Sent to your family with your current location."
        : "Sent to your family. Location was unavailable."
    );
  };

  /**
   * Creates the emergency session (not just an alert), attaching whatever
   * context the device can report. The persistent SOS state and the "I'm safe"
   * / acknowledge actions are rendered by SosBanner in the app layout so they
   * stay visible on every tab.
   */
  const fireSos = useCallback(async () => {
    if (!user || !currentFamily) {
      setError("Still loading your profile. Try again in a moment.");
      return;
    }

    setSosBusy(true);
    setError(null);
    try {
      const { session, queued, error: err } = await triggerSos({
        familyId: currentFamily.id,
        userId: user.id,
        userName,
      });

      if (err || !session) {
        setError(err?.message || "Could not raise the SOS. Try again.");
        return;
      }

      // Held locally so the emergency banner appears instantly and survives a
      // reload, even when the row has not reached Supabase yet.
      setLocalSos({
        id: session.id,
        familyId: currentFamily.id,
        createdAt: session.created_at,
        data: session.data ?? {},
        queued,
      });

      setSosActive(true);
      setNotice(
        queued
          ? "SOS recorded on this device. Your family will be alerted the moment you reconnect."
          : "SOS sent. Your family has been notified."
      );
    } finally {
      setSosBusy(false);
    }
  }, [user, currentFamily, userName, setLocalSos]);

  // Countdown tick. Cancelling simply clears the state, so nothing is sent.
  useEffect(() => {
    if (sosCountdown === null) return;

    if (sosCountdown <= 0) {
      setSosCountdown(null);
      void fireSos();
      return;
    }

    const timer = setTimeout(
      () => setSosCountdown((n) => (n === null ? null : n - 1)),
      1000
    );
    return () => clearTimeout(timer);
  }, [sosCountdown, fireSos]);

  const armSos = () => {
    setError(null);
    setSosCountdown(SOS_COUNTDOWN_SECONDS);
  };

  // An SOS raised offline has no server row yet, so local state counts too.
  const emergencyActive = sosActive || localSos !== null;

  const handleQuickAction = async (kind: "safe" | "help") => {
    setActionBusy(kind);
    try {
      if (kind === "safe") {
        await sendSignal(
          "safe",
          `${userName} checked in safe`,
          "Marked themselves as safe."
        );
      } else {
        await sendSignal(
          "help",
          `${userName} requested help`,
          "Asked for assistance — not an emergency SOS."
        );
      }
    } finally {
      setActionBusy(null);
    }
  };

  const saveContact = async () => {
    if (!user) return;
    if (!contactName.trim() || !contactPhone.trim()) {
      setError("Contact name and phone are both required.");
      return;
    }

    setContactSaving(true);
    try {
      const { error: err } = await supabase.from("emergency_contacts").insert({
        user_id: user.id,
        name: contactName.trim(),
        phone: contactPhone.trim(),
        relationship: contactRelation.trim() || null,
      });
      if (err) throw err;

      setContactName("");
      setContactPhone("");
      setContactRelation("");
      setContactDialogOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save contact.");
    } finally {
      setContactSaving(false);
    }
  };

  const deleteContact = async (id: string) => {
    const { error: err } = await supabase
      .from("emergency_contacts")
      .delete()
      .eq("id", id);
    if (err) setError(err.message);
    else await load();
  };

  return (
    <PullToRefresh onRefresh={load}>
      <div className="safe-top space-y-5 p-4">
        <header>
          <h1 className="text-2xl font-bold">Safety</h1>
          <p className="text-sm text-muted-foreground">
            Emergency signals, safe zones, and contacts
          </p>
        </header>

        {error && (
          <Card className="border-destructive/30 bg-destructive/10 p-3">
            <div className="flex gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          </Card>
        )}

        {notice && (
          <Card className="border-primary/30 bg-primary/10 p-3">
            <div className="flex gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <p className="text-sm text-primary">{notice}</p>
            </div>
          </Card>
        )}

        {/* SOS */}
        <Card className="p-6 text-center">
          <h2 className="mb-1 text-xl font-semibold">Emergency SOS</h2>
          <p className="mb-5 text-sm text-muted-foreground">
            {emergencyActive
              ? "An SOS is active. Use the banner above to confirm you are safe."
              : `Alerts everyone in ${currentFamily?.name ?? "your family"} with your location, battery, and activity. Works offline — it syncs when you reconnect.`}
          </p>

          <button
            type="button"
            onClick={armSos}
            disabled={sosBusy || !user || emergencyActive || sosCountdown !== null}
            aria-label="Send emergency SOS alert to family"
            className="mx-auto flex h-32 w-32 items-center justify-center rounded-full bg-gradient-to-br from-red-500 to-red-700 text-white shadow-2xl shadow-red-500/40 transition-transform active:scale-95 disabled:opacity-60"
          >
            {sosBusy ? (
              <Loader2 className="h-10 w-10 animate-spin" />
            ) : (
              <span>
                <span className="block text-3xl" aria-hidden="true">
                  {emergencyActive ? "🚨" : "🆘"}
                </span>
                <span className="mt-1 block text-sm font-bold">
                  {emergencyActive ? "ACTIVE" : "SOS"}
                </span>
              </span>
            )}
          </button>

          <p className="mt-5 text-xs text-muted-foreground">
            NoFikar does not contact emergency services. In a real emergency,
            call your local emergency number.
          </p>
        </Card>

        {/* Quick actions */}
        <div className="grid grid-cols-2 gap-3">
          <Button
            variant="outline"
            className="h-20 flex-col gap-2"
            onClick={() => handleQuickAction("safe")}
            disabled={actionBusy !== null || !user}
          >
            {actionBusy === "safe" ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <Shield className="h-6 w-6" />
            )}
            <span className="text-sm">I&apos;m safe</span>
          </Button>

          <Button
            variant="outline"
            className="h-20 flex-col gap-2"
            onClick={() => handleQuickAction("help")}
            disabled={actionBusy !== null || !user}
          >
            {actionBusy === "help" ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <AlertCircle className="h-6 w-6" />
            )}
            <span className="text-sm">Need help</span>
          </Button>
        </div>

        {/* Safe zones */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Safe zones</h2>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={!currentFamily}
              onClick={() => {
                setEditingZone(null);
                setZoneDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </div>

          {loading ? (
            <SkeletonList count={2} />
          ) : zones.length === 0 ? (
            <Card className="p-8 text-center">
              <MapPin className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
              <h3 className="mb-1 font-semibold">No safe zones yet</h3>
              <p className="mb-4 text-sm text-muted-foreground">
                Add places like home, school, or work to get alerts when family
                members arrive or leave.
              </p>
              <Button
                className="gap-2"
                disabled={!currentFamily}
                onClick={() => {
                  setEditingZone(null);
                  setZoneDialogOpen(true);
                }}
              >
                <Plus className="h-4 w-4" />
                Create safe zone
              </Button>
            </Card>
          ) : (
            <div className="space-y-3">
              {zones.map((zone) => (
                <Card key={zone.id} className="p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15">
                      <MapPin className="h-5 w-5 text-primary" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-semibold">{zone.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        {zone.radius}m radius
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                        {zone.notify_on_entry && (
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                            Arrival alerts
                          </span>
                        )}
                        {zone.notify_on_exit && (
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                            Leaving alerts
                          </span>
                        )}
                        {!zone.notify_on_entry && !zone.notify_on_exit && (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                            Alerts off
                          </span>
                        )}
                      </div>
                    </div>

                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${zone.name}`}
                      onClick={() => {
                        setEditingZone(zone);
                        setZoneDialogOpen(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* Emergency sessions */}
        {currentFamily && user && (
          <EmergencySessions
            familyId={currentFamily.id}
            userId={user.id}
            userName={userName}
            members={familyMembers}
          />
        )}

        {/* Emergency contacts */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Emergency contacts</h2>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setContactDialogOpen(true)}
            >
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </div>

          {loading ? (
            <Skeleton className="h-16 w-full" />
          ) : contacts.length === 0 ? (
            <Card className="p-6 text-center">
              <Phone className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Add the people you would want called in an emergency.
              </p>
            </Card>
          ) : (
            <div className="space-y-2">
              {contacts.map((c) => (
                <Card key={c.id} className="flex items-center gap-3 p-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary">
                    <Phone className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{c.name}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {c.phone}
                      {c.relationship ? ` · ${c.relationship}` : ""}
                    </p>
                  </div>
                  <a href={`tel:${c.phone}`} aria-label={`Call ${c.name}`}>
                    <Button variant="outline" size="sm">
                      Call
                    </Button>
                  </a>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${c.name}`}
                    onClick={() => deleteContact(c.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* Privacy */}
        <Card className="border-primary/20 bg-primary/5 p-4">
          <div className="flex gap-3">
            <Shield className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="text-sm">
              <p className="mb-1 font-medium text-primary">Privacy &amp; consent</p>
              <p className="text-muted-foreground">
                Safe zone alerts only apply to members who choose to share their
                location, and sharing can be stopped at any time.
              </p>
            </div>
          </div>
        </Card>

        <div className="h-4" />
      </div>

      {/* Accidental-press protection. Cancelling here sends nothing at all. */}
      <Dialog
        open={sosCountdown !== null}
        onOpenChange={(o) => !o && setSosCountdown(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              SOS will alert your family in {sosCountdown ?? 0}s
            </DialogTitle>
            <DialogDescription>
              Everyone in {currentFamily?.name ?? "your family"} will be notified
              with your current location, battery level, and activity.
            </DialogDescription>
          </DialogHeader>

          <div
            className="py-2 text-center text-5xl font-bold text-destructive"
            aria-live="assertive"
          >
            {sosCountdown ?? 0}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSosCountdown(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => setSosCountdown(0)}
              className="gap-2"
            >
              Send now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {currentFamily && (
        <SafeZoneDialog
          open={zoneDialogOpen}
          onOpenChange={setZoneDialogOpen}
          familyId={currentFamily.id}
          zone={editingZone}
          onSaved={load}
        />
      )}

      {/* Add contact */}
      <Dialog open={contactDialogOpen} onOpenChange={setContactDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add emergency contact</DialogTitle>
            <DialogDescription>
              Stored privately on your profile — other family members cannot see it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="contact-name">Name</Label>
              <Input
                id="contact-name"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                disabled={contactSaving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-phone">Phone</Label>
              <Input
                id="contact-phone"
                type="tel"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                disabled={contactSaving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-relation">Relationship (optional)</Label>
              <Input
                id="contact-relation"
                value={contactRelation}
                onChange={(e) => setContactRelation(e.target.value)}
                placeholder="e.g. Mother"
                disabled={contactSaving}
              />
            </div>
          </div>

          <DialogFooter>
            <Button onClick={saveContact} disabled={contactSaving} className="gap-2">
              {contactSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save contact
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PullToRefresh>
  );
}
