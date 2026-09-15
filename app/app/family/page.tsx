"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/lib/store";
import { getActivityStatus, getTimeAgo } from "@/lib/locationUtils";
import { presenceFor, PRESENCE_LABEL } from "@/lib/presence";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SkeletonList } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import PullToRefresh from "@/components/PullToRefresh";
import {
  Copy,
  Check,
  UserPlus,
  Crown,
  Clock,
  MapPin,
  BatteryMedium,
  MoreVertical,
  LogOut,
  Trash2,
  ArrowUpCircle,
  UserMinus,
  AlertCircle,
  Loader2,
  Share2,
} from "lucide-react";

interface MemberRow {
  id: string;
  user_id: string;
  role: "admin" | "member";
  name: string;
  joined_at: string;
  profiles: {
    name: string | null;
    avatar_url: string | null;
    battery_level: number | null;
    location_sharing_enabled: boolean | null;
    last_active: string | null;
  } | null;
  latest?: {
    speed: number;
    activity_status: string;
    created_at: string;
  } | null;
}

type ConfirmAction =
  | { kind: "remove"; member: MemberRow }
  | { kind: "promote"; member: MemberRow }
  | { kind: "leave" }
  | { kind: "delete" }
  | null;

export default function FamilyPage() {
  const router = useRouter();
  const { currentFamily, user, setCurrentFamily } = useAppStore();

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmAction>(null);
  const [busy, setBusy] = useState(false);

  const myRole = members.find((m) => m.user_id === user?.id)?.role;
  const isAdmin = myRole === "admin";
  const adminCount = members.filter((m) => m.role === "admin").length;

  const load = useCallback(async () => {
    if (!currentFamily) return;

    const { data, error: memberError } = await supabase
      .from("family_members")
      .select(
        "id, user_id, role, name, joined_at, profiles(name, avatar_url, battery_level, location_sharing_enabled, last_active)"
      )
      .eq("family_id", currentFamily.id)
      .order("joined_at", { ascending: true });

    if (memberError) {
      setError(memberError.message);
      return;
    }

    const rows = (data ?? []) as unknown as MemberRow[];

    // One query for the whole family instead of one per member, then reduce to
    // the newest row per user.
    const { data: locations } = await supabase
      .from("location_history")
      .select("user_id, speed, activity_status, created_at")
      .eq("family_id", currentFamily.id)
      .order("created_at", { ascending: false })
      .limit(200);

    const newest = new Map<string, MemberRow["latest"]>();
    for (const loc of locations ?? []) {
      if (!newest.has(loc.user_id)) {
        newest.set(loc.user_id, {
          speed: loc.speed,
          activity_status: loc.activity_status,
          created_at: loc.created_at,
        });
      }
    }

    setMembers(rows.map((r) => ({ ...r, latest: newest.get(r.user_id) ?? null })));
    setError(null);
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
      .channel(`family-members-${currentFamily.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "family_members",
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

  const copyCode = async () => {
    if (!currentFamily?.code) return;
    try {
      await navigator.clipboard.writeText(currentFamily.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy. Select the code and copy it manually.");
    }
  };

  const shareInvite = async () => {
    if (!currentFamily) return;
    const text = `Join our family "${currentFamily.name}" on NoFikar with code ${currentFamily.code}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "NoFikar invite", text });
      } else {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // User dismissed the share sheet — nothing to report.
    }
  };

  const runConfirm = async () => {
    if (!confirm || !currentFamily || !user) return;

    setBusy(true);
    setError(null);

    try {
      if (confirm.kind === "remove") {
        const { error: err } = await supabase
          .from("family_members")
          .delete()
          .eq("id", confirm.member.id);
        if (err) throw err;
        await load();
      }

      if (confirm.kind === "promote") {
        const { error: err } = await supabase
          .from("family_members")
          .update({ role: "admin" })
          .eq("id", confirm.member.id);
        if (err) throw err;
        await load();
      }

      if (confirm.kind === "leave") {
        const mine = members.find((m) => m.user_id === user.id);
        if (!mine) throw new Error("Could not find your membership.");

        const { error: err } = await supabase
          .from("family_members")
          .delete()
          .eq("id", mine.id);
        if (err) throw err;

        setCurrentFamily(null);
        router.push("/onboarding");
        return;
      }

      if (confirm.kind === "delete") {
        // family_members, safe_zones, alerts, and location_history all cascade
        // from families.id.
        const { error: err } = await supabase
          .from("families")
          .delete()
          .eq("id", currentFamily.id);
        if (err) throw err;

        setCurrentFamily(null);
        router.push("/onboarding");
        return;
      }

      setConfirm(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setBusy(false);
      setMenuFor(null);
      if (confirm?.kind === "remove" || confirm?.kind === "promote") {
        setConfirm(null);
      }
    }
  };

  const confirmCopy: Record<
    Exclude<ConfirmAction, null>["kind"],
    { title: string; body: string; cta: string; destructive: boolean }
  > = {
    remove: {
      title: "Remove member?",
      body: "They will stop sharing location with this family and lose access to its alerts and safe zones.",
      cta: "Remove",
      destructive: true,
    },
    promote: {
      title: "Make admin?",
      body: "Admins can manage members, rename the family, and delete it.",
      cta: "Make admin",
      destructive: false,
    },
    leave: {
      title: "Leave this family?",
      body: "You will stop sharing location with them and lose access to this family's alerts and safe zones.",
      cta: "Leave family",
      destructive: true,
    },
    delete: {
      title: "Delete this family?",
      body: "This permanently removes the family, its members, safe zones, alerts, and location history. This cannot be undone.",
      cta: "Delete family",
      destructive: true,
    },
  };

  return (
    <PullToRefresh onRefresh={load}>
      <div className="safe-top space-y-5 p-4">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">Family</h1>
            <p className="truncate text-sm text-muted-foreground">
              {currentFamily?.name ?? "Loading..."}
              {myRole && ` · you are ${myRole === "admin" ? "an admin" : "a member"}`}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={() => setInviteOpen(true)}
            disabled={!currentFamily}
          >
            <UserPlus className="h-4 w-4" />
            Invite
          </Button>
        </header>

        {error && (
          <Card className="border-destructive/30 bg-destructive/10 p-3">
            <div className="flex gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          </Card>
        )}

        {/* Members */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Members {!loading && `(${members.length})`}
          </h2>

          {loading ? (
            <SkeletonList count={3} />
          ) : (
            <div className="space-y-3">
              {members.map((m) => {
                const isMe = m.user_id === user?.id;
                const displayName = m.profiles?.name || m.name;
                // The stored sharing flag alone stays true after a tab close or
                // signal loss, so presence also requires a recent fix.
                const presence = presenceFor({
                  sharingEnabled: m.profiles?.location_sharing_enabled,
                  lastFixAt: m.latest?.created_at ?? null,
                });
                const sharing = presence === "live";
                const activity = m.latest
                  ? getActivityStatus(m.latest.speed)
                  : null;

                return (
                  <Card key={m.id} className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="relative shrink-0">
                        <span className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-primary/15 text-lg font-semibold">
                          {m.profiles?.avatar_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={m.profiles.avatar_url}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            displayName.slice(0, 1).toUpperCase()
                          )}
                        </span>
                        {sharing && (
                          <span
                            aria-label="Sharing location"
                            className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full border-2 border-background bg-primary"
                          />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-semibold">{displayName}</span>
                          {m.role === "admin" && (
                            <Crown
                              className="h-4 w-4 shrink-0 text-primary"
                              aria-label="Admin"
                            />
                          )}
                          {isMe && (
                            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                              You
                            </span>
                          )}
                        </div>

                        <div className="mt-0.5 space-y-0.5 text-sm text-muted-foreground">
                          {sharing && activity && m.latest ? (
                            <p className="flex flex-wrap items-center gap-x-3">
                              <span>
                                {activity.icon} {activity.label}
                              </span>
                              <span className="flex items-center gap-1">
                                <MapPin className="h-3 w-3" />
                                {m.latest.speed.toFixed(0)} km/h
                              </span>
                              <span>{getTimeAgo(m.latest.created_at)}</span>
                            </p>
                          ) : presence === "stale" && m.latest ? (
                            <p className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {PRESENCE_LABEL.stale}{" "}
                              {getTimeAgo(m.latest.created_at)}
                            </p>
                          ) : (
                            <p className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {m.profiles?.last_active
                                ? `Last active ${getTimeAgo(m.profiles.last_active)}`
                                : "Not sharing location"}
                            </p>
                          )}

                          {m.profiles?.battery_level != null && (
                            <p className="flex items-center gap-1">
                              <BatteryMedium className="h-3 w-3" />
                              {m.profiles.battery_level}%
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Per-member admin actions */}
                      {isAdmin && !isMe && (
                        <div className="relative shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Actions for ${displayName}`}
                            onClick={() =>
                              setMenuFor(menuFor === m.id ? null : m.id)
                            }
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>

                          {menuFor === m.id && (
                            <>
                              {/* Click-away layer */}
                              <button
                                type="button"
                                aria-hidden="true"
                                tabIndex={-1}
                                className="fixed inset-0 z-10 cursor-default"
                                onClick={() => setMenuFor(null)}
                              />
                              <div className="absolute right-0 top-11 z-20 w-48 overflow-hidden rounded-xl border bg-popover shadow-lg">
                                {m.role !== "admin" && (
                                  <button
                                    type="button"
                                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-accent"
                                    onClick={() => {
                                      setMenuFor(null);
                                      setConfirm({ kind: "promote", member: m });
                                    }}
                                  >
                                    <ArrowUpCircle className="h-4 w-4" />
                                    Make admin
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-destructive hover:bg-destructive/10"
                                  onClick={() => {
                                    setMenuFor(null);
                                    setConfirm({ kind: "remove", member: m });
                                  }}
                                >
                                  <UserMinus className="h-4 w-4" />
                                  Remove from family
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        {/* Danger zone */}
        {!loading && currentFamily && (
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Manage
            </h2>
            <Card className="divide-y">
              <button
                type="button"
                className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-accent/50 disabled:opacity-50"
                disabled={isAdmin && adminCount === 1 && members.length > 1}
                onClick={() => setConfirm({ kind: "leave" })}
              >
                <LogOut className="h-5 w-5 text-muted-foreground" />
                <span className="flex-1">
                  <span className="block font-medium">Leave family</span>
                  {isAdmin && adminCount === 1 && members.length > 1 && (
                    <span className="block text-sm text-muted-foreground">
                      Make someone else an admin first
                    </span>
                  )}
                </span>
              </button>

              {isAdmin && (
                <button
                  type="button"
                  className="flex w-full items-center gap-3 p-4 text-left text-destructive transition-colors hover:bg-destructive/10"
                  onClick={() => setConfirm({ kind: "delete" })}
                >
                  <Trash2 className="h-5 w-5" />
                  <span className="flex-1 font-medium">Delete family</span>
                </button>
              )}
            </Card>
          </section>
        )}

        <div className="h-4" />
      </div>

      {/* Invite */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite to {currentFamily?.name}</DialogTitle>
            <DialogDescription>
              Share this code, or let them scan the QR on the signup screen.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {currentFamily?.code && (
              <div className="flex justify-center rounded-2xl bg-white p-4">
                <QRCodeSVG
                  value={currentFamily.code}
                  size={168}
                  aria-label="Family invite QR code"
                />
              </div>
            )}

            <div className="flex gap-2">
              <Input
                value={currentFamily?.code ?? ""}
                readOnly
                aria-label="Family invite code"
                className="text-center font-mono text-2xl tracking-[0.3em]"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={copyCode}
                aria-label="Copy invite code"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-primary" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>

            {copied && (
              <p className="text-center text-xs text-primary">Copied</p>
            )}

            <Button onClick={shareInvite} className="w-full gap-2">
              <Share2 className="h-4 w-4" />
              Share invite
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmations */}
      <Dialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
      >
        <DialogContent>
          {confirm && (
            <>
              <DialogHeader>
                <DialogTitle>{confirmCopy[confirm.kind].title}</DialogTitle>
                <DialogDescription>
                  {confirm.kind === "remove"
                    ? `${confirm.member.profiles?.name || confirm.member.name} will be removed. ${confirmCopy.remove.body}`
                    : confirm.kind === "promote"
                    ? `${confirm.member.profiles?.name || confirm.member.name} will become an admin. ${confirmCopy.promote.body}`
                    : confirmCopy[confirm.kind].body}
                </DialogDescription>
              </DialogHeader>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setConfirm(null)}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button
                  variant={
                    confirmCopy[confirm.kind].destructive ? "destructive" : "default"
                  }
                  onClick={runConfirm}
                  disabled={busy}
                  className="gap-2"
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  {confirmCopy[confirm.kind].cta}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </PullToRefresh>
  );
}
