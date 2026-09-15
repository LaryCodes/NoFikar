"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { createAlert } from "@/lib/alerts";
import {
  openReceiverLink,
  openSenderLink,
  hasTurnRelay,
  type LinkState,
  type MediaLink,
} from "@/lib/webrtc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Video,
  Mic,
  ShieldCheck,
  AlertCircle,
  Loader2,
  Square,
  Info,
  Volume2,
} from "lucide-react";
import type { EmergencySession } from "@/types";

/** How long an approved session stays open before it expires itself. */
const SESSION_SECONDS = 120;

interface Member {
  user_id: string;
  name: string;
}

interface Props {
  familyId: string;
  userId: string;
  userName: string;
  members: Member[];
}

const LINK_COPY: Record<LinkState, string> = {
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Reconnecting…",
  failed: "Connection failed",
  closed: "Closed",
};

export default function EmergencySessions({
  familyId,
  userId,
  userName,
  members,
}: Props) {
  const [incoming, setIncoming] = useState<EmergencySession | null>(null);
  const [outgoing, setOutgoing] = useState<EmergencySession | null>(null);
  /** Session where THIS device owns the camera/mic and publishes it. */
  const [sending, setSending] = useState<EmergencySession | null>(null);
  /** Session where THIS device requested and receives the remote media. */
  const [receiving, setReceiving] = useState<EmergencySession | null>(null);

  const [remaining, setRemaining] = useState(0);
  const [linkState, setLinkState] = useState<LinkState>("connecting");
  const [needsGesture, setNeedsGesture] = useState(false);

  const [requestOpen, setRequestOpen] = useState(false);
  const [requestKind, setRequestKind] = useState<"camera" | "audio">("camera");
  const [requestTarget, setRequestTarget] = useState<string>("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const linkRef = useRef<MediaLink | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  /** Session id whose capture this device actually holds right now. */
  const ownedSessionRef = useRef<string | null>(null);
  /** Guards against the expiry timer firing endSession more than once. */
  const closingRef = useRef<string | null>(null);

  const others = members.filter((m) => m.user_id !== userId);
  const active = sending ?? receiving;

  // `load()` rebuilds these objects on every realtime event, so effects key off
  // stable primitives instead of object identity — otherwise the peer
  // connection would be torn down and rebuilt on every row change.
  const activeRef = useRef<EmergencySession | null>(null);
  activeRef.current = active;
  const activeId = active?.id ?? null;
  const activeExpiresAt = active?.expires_at ?? null;
  const receivingId = receiving?.id ?? null;
  const receivingKind = receiving?.session_type ?? null;

  /** Releases camera/mic hardware and the peer connection. Every exit path. */
  const teardown = useCallback(() => {
    linkRef.current?.close();
    linkRef.current = null;

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    ownedSessionRef.current = null;

    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;

    setNeedsGesture(false);
    setLinkState("connecting");
  }, []);

  const endSession = useCallback(
    async (session: EmergencySession, reason: "expired" | "ended") => {
      teardown();
      setSending(null);
      setReceiving(null);
      setRemaining(0);

      await supabase
        .from("emergency_sessions")
        .update({ status: reason, ended_at: new Date().toISOString() })
        .eq("id", session.id);

      await createAlert({
        familyId,
        userId,
        type: "emergency_session_ended",
        title: `${session.session_type === "camera" ? "Camera" : "Microphone"} session ${reason}`,
        message:
          reason === "expired"
            ? "The session reached its time limit and closed automatically."
            : "The session was ended.",
        data: { session_id: session.id },
      });
    },
    [familyId, userId, teardown]
  );

  // ---- load + subscribe -------------------------------------------------
  const load = useCallback(async () => {
    const { data } = await supabase
      .from("emergency_sessions")
      .select("*")
      .eq("family_id", familyId)
      .in("session_type", ["camera", "audio"])
      .in("status", ["pending", "active"])
      .order("created_at", { ascending: false });

    const rows = (data ?? []) as EmergencySession[];

    setIncoming(
      rows.find((r) => r.target_id === userId && r.status === "pending") ?? null
    );
    setOutgoing(
      rows.find((r) => r.requester_id === userId && r.status === "pending") ?? null
    );

    const mineToPublish =
      rows.find((r) => r.target_id === userId && r.status === "active") ?? null;
    const mineToReceive =
      rows.find((r) => r.requester_id === userId && r.status === "active") ?? null;

    // An 'active' row that this device does not hold capture for is an orphan
    // from a previous page life (reload / crash). Close it rather than leaving
    // a session that claims to be live with nothing behind it.
    if (mineToPublish && ownedSessionRef.current !== mineToPublish.id) {
      await supabase
        .from("emergency_sessions")
        .update({ status: "ended", ended_at: new Date().toISOString() })
        .eq("id", mineToPublish.id);
      setSending(null);
    } else {
      setSending(mineToPublish);
    }

    setReceiving(mineToReceive);

    // The other side closed it: release local hardware immediately.
    if (!mineToPublish && !mineToReceive && ownedSessionRef.current) {
      teardown();
    }
  }, [familyId, userId, teardown]);

  useEffect(() => {
    load();

    const channel = supabase
      .channel(`emergency-${familyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "emergency_sessions",
          filter: `family_id=eq.${familyId}`,
        },
        () => load()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [familyId, load]);

  // Release hardware if the component unmounts mid-session.
  useEffect(() => teardown, [teardown]);

  // ---- receiver side: open the peer connection for an active request ------
  useEffect(() => {
    if (!receivingId || !receivingKind) return;

    setLinkState("connecting");
    const link = openReceiverLink({
      sessionId: receivingId,
      onState: setLinkState,
      onStream: (stream) => {
        if (receivingKind === "camera" && remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream;
          remoteVideoRef.current.play().catch(() => setNeedsGesture(true));
        }
        if (receivingKind === "audio" && remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = stream;
          // Autoplay with sound is blocked until the user interacts on most
          // mobile browsers, so fall back to an explicit control.
          remoteAudioRef.current.play().catch(() => setNeedsGesture(true));
        }
      },
    });
    linkRef.current = link;

    return () => {
      link.close();
      if (linkRef.current === link) linkRef.current = null;
    };
  }, [receivingId, receivingKind]);

  // ---- expiry countdown -------------------------------------------------
  useEffect(() => {
    if (!activeId || !activeExpiresAt) return;

    const tick = () => {
      const left = Math.max(
        0,
        Math.round((new Date(activeExpiresAt).getTime() - Date.now()) / 1000)
      );
      setRemaining(left);

      if (left === 0 && closingRef.current !== activeId) {
        closingRef.current = activeId;
        const session = activeRef.current;
        if (session) void endSession(session, "expired");
      }
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [activeId, activeExpiresAt, endSession]);

  // ---- actions ----------------------------------------------------------
  const sendRequest = async () => {
    if (!requestTarget) {
      setError("Choose who to request from.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase.from("emergency_sessions").insert({
        family_id: familyId,
        requester_id: userId,
        target_id: requestTarget,
        session_type: requestKind,
        status: "pending",
      });
      if (err) throw err;

      setRequestOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send request.");
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!incoming) return;

    setBusy(true);
    setError(null);

    try {
      // Ask for hardware BEFORE marking approved, so a denied browser prompt
      // does not leave a session claiming to be active.
      const stream = await navigator.mediaDevices.getUserMedia(
        incoming.session_type === "camera"
          ? { video: { facingMode: "environment" }, audio: true }
          : { audio: true }
      );
      streamRef.current = stream;
      // Claim ownership before the row flips to 'active', otherwise the
      // realtime reload could see an 'active' row this device does not yet
      // admit owning and immediately close it as an orphan.
      ownedSessionRef.current = incoming.id;

      const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
      const { data, error: err } = await supabase
        .from("emergency_sessions")
        .update({
          status: "active",
          approved_at: new Date().toISOString(),
          expires_at: expiresAt,
        })
        .eq("id", incoming.id)
        .select()
        .maybeSingle();

      if (err) throw err;

      const session = (data ?? { ...incoming, expires_at: expiresAt }) as EmergencySession;
      ownedSessionRef.current = session.id;
      setSending(session);
      setIncoming(null);
      setLinkState("connecting");

      // Local confirmation preview: the approving device must be able to see
      // exactly what it is sharing.
      if (session.session_type === "camera" && localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // The actual media transport to the requester.
      linkRef.current = openSenderLink({
        sessionId: session.id,
        stream,
        onState: setLinkState,
      });

      await createAlert({
        familyId,
        userId,
        type: "emergency_session_started",
        title: `${userName} approved a ${session.session_type} session`,
        message: `Consented to a temporary ${session.session_type} session. It closes automatically in ${SESSION_SECONDS / 60} minutes.`,
        data: { session_id: session.id },
      });
    } catch (err) {
      teardown();
      const message =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Permission denied in the browser, so the session was not started."
          : err instanceof DOMException && err.name === "NotFoundError"
          ? "No camera or microphone was found on this device."
          : err instanceof Error
          ? err.message
          : "Could not start the session.";
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!incoming) return;

    setBusy(true);
    try {
      await supabase
        .from("emergency_sessions")
        .update({ status: "rejected", ended_at: new Date().toISOString() })
        .eq("id", incoming.id);
      setIncoming(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const cancelOutgoing = async () => {
    if (!outgoing) return;
    setBusy(true);
    try {
      await supabase
        .from("emergency_sessions")
        .update({ status: "ended", ended_at: new Date().toISOString() })
        .eq("id", outgoing.id);
      setOutgoing(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const playRemote = async () => {
    try {
      if (receiving?.session_type === "camera") await remoteVideoRef.current?.play();
      else await remoteAudioRef.current?.play();
      setNeedsGesture(false);
    } catch {
      setError("Your browser blocked playback. Check the site's audio settings.");
    }
  };

  const nameFor = (id: string) =>
    members.find((m) => m.user_id === id)?.name ?? "Family member";

  const clock = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;

  return (
    <section>
      <h2 className="mb-3 font-semibold">Emergency session</h2>

      {error && (
        <Card className="mb-3 border-destructive/30 bg-destructive/10 p-3">
          <div className="flex gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        </Card>
      )}

      {/* This device is SHARING its camera/mic */}
      {sending && (
        <Card className="mb-3 border-primary/40 p-4">
          <div className="mb-1 flex items-center justify-between">
            <span className="flex items-center gap-2 font-semibold text-primary">
              <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
              {sending.session_type === "camera" ? "Camera" : "Microphone"} sharing
              active
            </span>
            <span
              className="font-mono text-sm text-muted-foreground"
              aria-live="polite"
            >
              {clock}
            </span>
          </div>

          <p className="mb-3 text-xs text-muted-foreground">
            Sharing with {nameFor(sending.requester_id)} · {LINK_COPY[linkState]}
          </p>

          {sending.session_type === "camera" ? (
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="mb-3 aspect-video w-full rounded-xl bg-black object-cover"
            />
          ) : (
            <div className="mb-3 flex items-center justify-center gap-2 rounded-xl bg-muted py-8">
              <Mic className="h-6 w-6 animate-pulse text-primary" />
              <span className="text-sm text-muted-foreground">
                Your microphone is being shared
              </span>
            </div>
          )}

          <Button
            variant="destructive"
            className="w-full gap-2"
            onClick={() => endSession(sending, "ended")}
          >
            <Square className="h-4 w-4" />
            Stop sharing now
          </Button>
        </Card>
      )}

      {/* This device is VIEWING a family member's camera/mic */}
      {receiving && (
        <Card className="mb-3 border-primary/40 p-4">
          <div className="mb-1 flex items-center justify-between">
            <span className="flex items-center gap-2 font-semibold text-primary">
              <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
              {nameFor(receiving.target_id)}&apos;s{" "}
              {receiving.session_type === "camera" ? "camera" : "microphone"}
            </span>
            <span
              className="font-mono text-sm text-muted-foreground"
              aria-live="polite"
            >
              {clock}
            </span>
          </div>

          <p className="mb-3 text-xs text-muted-foreground">
            {LINK_COPY[linkState]}
          </p>

          {receiving.session_type === "camera" ? (
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="mb-3 aspect-video w-full rounded-xl bg-black object-cover"
            />
          ) : (
            <>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio ref={remoteAudioRef} autoPlay className="hidden" />
              <div className="mb-3 flex items-center justify-center gap-2 rounded-xl bg-muted py-8">
                <Volume2 className="h-6 w-6 text-primary" />
                <span className="text-sm text-muted-foreground">
                  {linkState === "connected" ? "Listening" : LINK_COPY[linkState]}
                </span>
              </div>
            </>
          )}

          {needsGesture && (
            <Button variant="outline" className="mb-2 w-full gap-2" onClick={playRemote}>
              <Volume2 className="h-4 w-4" />
              Tap to start playback
            </Button>
          )}

          {linkState === "failed" && (
            <p className="mb-2 text-xs text-destructive">
              Could not establish a direct connection. This usually means both
              devices are behind restrictive mobile NAT and a TURN relay is
              needed.
            </p>
          )}

          <Button
            variant="destructive"
            className="w-full gap-2"
            onClick={() => endSession(receiving, "ended")}
          >
            <Square className="h-4 w-4" />
            End session now
          </Button>
        </Card>
      )}

      {/* Incoming request needing consent */}
      {incoming && !active && (
        <Card className="mb-3 border-primary/40 bg-primary/5 p-4">
          <div className="mb-3 flex gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div>
              <p className="font-semibold">
                {nameFor(incoming.requester_id)} is requesting your{" "}
                {incoming.session_type}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Nothing turns on unless you approve. If you approve, a live{" "}
                {incoming.session_type} stream is sent to them. The session
                closes automatically after {SESSION_SECONDS / 60} minutes, and
                you can end it sooner at any time.
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={reject}
              disabled={busy}
            >
              Decline
            </Button>
            <Button className="flex-1 gap-2" onClick={approve} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Approve
            </Button>
          </div>
        </Card>
      )}

      {/* Outgoing request awaiting consent */}
      {outgoing && (
        <Card className="mb-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium">
                Waiting for {nameFor(outgoing.target_id)}
              </p>
              <p className="text-sm text-muted-foreground">
                {outgoing.session_type === "camera" ? "Camera" : "Microphone"}{" "}
                request pending approval
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={cancelOutgoing}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {/* Request launcher */}
      {!active && !incoming && !outgoing && (
        <Card className="p-4">
          <p className="mb-3 text-sm text-muted-foreground">
            Ask a family member to temporarily share their camera or microphone.
            They must approve, and the session expires on its own.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="h-16 flex-col gap-1.5"
              disabled={others.length === 0}
              onClick={() => {
                setRequestKind("camera");
                setRequestTarget(others[0]?.user_id ?? "");
                setRequestOpen(true);
              }}
            >
              <Video className="h-5 w-5" />
              <span className="text-sm">Request camera</span>
            </Button>
            <Button
              variant="outline"
              className="h-16 flex-col gap-1.5"
              disabled={others.length === 0}
              onClick={() => {
                setRequestKind("audio");
                setRequestTarget(others[0]?.user_id ?? "");
                setRequestOpen(true);
              }}
            >
              <Mic className="h-5 w-5" />
              <span className="text-sm">Request audio</span>
            </Button>
          </div>
          {others.length === 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Invite someone to your family to use this.
            </p>
          )}
        </Card>
      )}

      {/* Deployment note: peer-to-peer works on most networks with STUN alone,
          but strict carrier NAT needs a TURN relay. */}
      {!hasTurnRelay() && (
        <Card className="mt-3 border-amber-500/30 bg-amber-500/10 p-3">
          <div className="flex gap-2">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Streaming is peer-to-peer over WebRTC using public STUN only. It
              works on most Wi-Fi and mobile networks; if a connection fails on
              a strict mobile network, configure a TURN relay via
              NEXT_PUBLIC_TURN_URLS. Nothing is captured without consent, and
              media never passes through NoFikar&apos;s database.
            </p>
          </div>
        </Card>
      )}

      {/* Confirm request */}
      <Dialog open={requestOpen} onOpenChange={setRequestOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Request {requestKind === "camera" ? "camera" : "microphone"}
            </DialogTitle>
            <DialogDescription>
              They will be asked to approve. Nothing is captured without their
              explicit consent.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label htmlFor="session-target" className="text-sm font-medium">
              Family member
            </label>
            <select
              id="session-target"
              value={requestTarget}
              onChange={(e) => setRequestTarget(e.target.value)}
              className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
            >
              {others.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRequestOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button onClick={sendRequest} disabled={busy} className="gap-2">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Send request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
