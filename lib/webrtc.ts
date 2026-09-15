import { supabase } from "@/lib/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * Media transport for consented camera / microphone sessions.
 *
 * The previous implementation had NO transport at all: the approving device
 * called getUserMedia() and attached the stream to its OWN <video>. The
 * requester's element was never given a stream, which is exactly why it showed
 * a black rectangle. getUserMedia() cannot move media between devices.
 *
 * This adds the missing piece: a peer-to-peer WebRTC connection, with Supabase
 * Realtime *broadcast* used purely as the signalling path (offer / answer /
 * ICE). Supabase never carries the media itself.
 *
 *   requester (receiver)                target (sender, owns the camera)
 *        │  subscribe, announce "ready"        │
 *        │ ──────────────────────────────────► │
 *        │                                     │ getUserMedia + createOffer
 *        │ ◄────────────── offer ───────────── │
 *        │ ──────────────── answer ──────────► │
 *        │ ◄──────────── ICE both ways ──────► │
 *        │ ◄═══════════ media (P2P) ══════════ │
 *
 * Signalling channels are keyed by the session UUID, and the session row itself
 * is protected by RLS (only the requester and target can update it), so a
 * stream cannot be established without a consented session row existing first.
 */

type Signal =
  | { kind: "ready" }
  | { kind: "offer"; sdp: RTCSessionDescriptionInit }
  | { kind: "answer"; sdp: RTCSessionDescriptionInit }
  | { kind: "ice"; candidate: RTCIceCandidateInit };

const SIGNAL_EVENT = "signal";

/**
 * Public STUN is enough for most home Wi-Fi and many mobile networks. Carrier
 * grade NAT and symmetric NAT need a TURN relay, which is deployment
 * configuration rather than code — supply it through env vars when available.
 */
export function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
      ],
    },
  ];

  const turnUrls = process.env.NEXT_PUBLIC_TURN_URLS;
  if (turnUrls) {
    servers.push({
      urls: turnUrls.split(",").map((u) => u.trim()).filter(Boolean),
      username: process.env.NEXT_PUBLIC_TURN_USERNAME,
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
    });
  }

  return servers;
}

export function hasTurnRelay(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_TURN_URLS);
}

export type LinkState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed"
  | "closed";

export interface MediaLink {
  close: () => void;
}

interface CommonOptions {
  sessionId: string;
  onState: (state: LinkState) => void;
}

function mapConnectionState(state: RTCPeerConnectionState): LinkState {
  switch (state) {
    case "connected":
      return "connected";
    case "disconnected":
      return "reconnecting";
    case "failed":
      return "failed";
    case "closed":
      return "closed";
    default:
      return "connecting";
  }
}

/** Shared plumbing: peer connection, ICE trickling, candidate buffering. */
function buildPeer(
  channel: RealtimeChannel,
  onState: (state: LinkState) => void
) {
  const pc = new RTCPeerConnection({ iceServers: iceServers() });
  const pendingCandidates: RTCIceCandidateInit[] = [];
  let remoteReady = false;

  const send = (signal: Signal) => {
    void channel.send({ type: "broadcast", event: SIGNAL_EVENT, payload: signal });
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) send({ kind: "ice", candidate: event.candidate.toJSON() });
  };

  pc.onconnectionstatechange = () => onState(mapConnectionState(pc.connectionState));

  const addCandidate = async (candidate: RTCIceCandidateInit) => {
    // A candidate can arrive before the remote description is set; applying it
    // then throws, so buffer until the description lands.
    if (!remoteReady) {
      pendingCandidates.push(candidate);
      return;
    }
    try {
      await pc.addIceCandidate(candidate);
    } catch (err) {
      console.warn("Failed to add ICE candidate:", err);
    }
  };

  const flushCandidates = async () => {
    remoteReady = true;
    while (pendingCandidates.length > 0) {
      const candidate = pendingCandidates.shift();
      if (!candidate) continue;
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        console.warn("Failed to add buffered ICE candidate:", err);
      }
    }
  };

  return { pc, send, addCandidate, flushCandidates };
}

function closeLink(pc: RTCPeerConnection, channel: RealtimeChannel) {
  pc.getSenders().forEach((s) => {
    try {
      s.track?.stop();
    } catch {
      // Track may already be stopped by the caller's own cleanup.
    }
  });
  pc.onicecandidate = null;
  pc.ontrack = null;
  pc.onconnectionstatechange = null;
  pc.close();
  void supabase.removeChannel(channel);
}

/**
 * Runs on the device that OWNS the camera/microphone (the one that consented).
 * Publishes `stream` to the requester.
 */
export function openSenderLink(
  options: CommonOptions & { stream: MediaStream }
): MediaLink {
  const { sessionId, stream, onState } = options;

  const channel = supabase.channel(`rtc-${sessionId}`, {
    config: { broadcast: { self: false } },
  });

  const { pc, send, addCandidate, flushCandidates } = buildPeer(channel, onState);

  stream.getTracks().forEach((track) => pc.addTrack(track, stream));

  let offering = false;
  const sendOffer = async () => {
    if (offering) return;
    offering = true;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send({ kind: "offer", sdp: offer });
    } catch (err) {
      console.error("Failed to create WebRTC offer:", err);
      onState("failed");
    } finally {
      offering = false;
    }
  };

  channel.on("broadcast", { event: SIGNAL_EVENT }, async ({ payload }) => {
    const signal = payload as Signal;

    // The receiver may subscribe after the first offer was broadcast, so a
    // "ready" always re-offers. This removes the join-order race entirely.
    if (signal.kind === "ready") {
      if (pc.signalingState === "stable" && pc.currentRemoteDescription) return;
      await sendOffer();
      return;
    }

    if (signal.kind === "answer") {
      if (pc.signalingState !== "have-local-offer") return;
      await pc.setRemoteDescription(signal.sdp);
      await flushCandidates();
      return;
    }

    if (signal.kind === "ice") {
      await addCandidate(signal.candidate);
    }
  });

  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") void sendOffer();
    else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") onState("failed");
  });

  return {
    close: () => closeLink(pc, channel),
  };
}

/**
 * Runs on the device that REQUESTED the media. Receives the remote stream.
 * Subscribe as soon as a request is pending so the offer is never missed.
 */
export function openReceiverLink(
  options: CommonOptions & { onStream: (stream: MediaStream) => void }
): MediaLink {
  const { sessionId, onStream, onState } = options;

  const channel = supabase.channel(`rtc-${sessionId}`, {
    config: { broadcast: { self: false } },
  });

  const { pc, send, addCandidate, flushCandidates } = buildPeer(channel, onState);

  // Declaring the directions up front keeps the answer's SDP compatible with
  // an offer that carries video and/or audio.
  pc.ontrack = (event) => {
    if (event.streams[0]) onStream(event.streams[0]);
  };

  channel.on("broadcast", { event: SIGNAL_EVENT }, async ({ payload }) => {
    const signal = payload as Signal;

    if (signal.kind === "offer") {
      try {
        await pc.setRemoteDescription(signal.sdp);
        await flushCandidates();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        send({ kind: "answer", sdp: answer });
      } catch (err) {
        console.error("Failed to answer WebRTC offer:", err);
        onState("failed");
      }
      return;
    }

    if (signal.kind === "ice") {
      await addCandidate(signal.candidate);
    }
  });

  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") send({ kind: "ready" });
    else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") onState("failed");
  });

  return {
    close: () => closeLink(pc, channel),
  };
}
