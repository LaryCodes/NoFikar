"use client";

import { useEffect, useRef, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Presence } from "@/lib/presence";
import type { RouteSegment } from "@/lib/routes";

export interface MapMember {
  user_id: string;
  name: string;
  avatar_url?: string | null;
  latitude: number;
  longitude: number;
  speed: number;
  accuracy: number;
  activity_status: string;
  battery_level?: number | null;
  created_at: string;
  isMe: boolean;
  /** Derived from sharing flag + fix recency; drives marker styling. */
  presence: Presence;
}

export interface MapZone {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
}

export interface MapViewProps {
  members?: MapMember[];
  zones?: MapZone[];
  /**
   * Recorded path, split into runs. Offline-captured runs are drawn distinctly
   * so a recovered route is visibly different from a live one.
   */
  segments?: RouteSegment[];
  /** Marker for the route-playback scrubber. */
  playbackPosition?: { lat: number; lng: number } | null;
  /** Tap-to-place mode, used by the safe-zone location picker. */
  pickerMode?: boolean;
  pickerPosition?: { lat: number; lng: number } | null;
  pickerRadius?: number;
  onPick?: (lat: number, lng: number) => void;
  /** Tapping a marker selects it; the page renders the detail sheet. */
  selectedUserId?: string | null;
  onSelectMember?: (userId: string | null) => void;
  /** While set, the map keeps this member centred as new fixes arrive. */
  followUserId?: string | null;
  /** Pan to this member once, e.g. from an SOS "View location" action. */
  focusUserId?: string | null;
  className?: string;
}

const ACTIVITY_COLORS: Record<string, string> = {
  Stationary: "#3d9970",
  Walking: "#2f80ed",
  Driving: "#f2994a",
  SOS: "#eb5757",
};

/** Offline members keep their pin but read as clearly inactive. */
const OFFLINE_COLOR = "#8a8f8c";

function colorFor(m: MapMember) {
  if (m.presence === "offline") return OFFLINE_COLOR;
  return ACTIVITY_COLORS[m.activity_status] ?? "#3d9970";
}

/** Initials fallback so markers never depend on a remote avatar loading. */
function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/** Avatar URLs and names end up in markup, so they must be escaped. */
function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function memberIcon(m: MapMember, selected: boolean) {
  const color = colorFor(m);
  const inner = m.avatar_url
    ? `<img src="${escapeHtml(m.avatar_url)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%" />`
    : `<span style="font-size:13px;font-weight:600;color:#fff">${escapeHtml(initials(m.name))}</span>`;

  // Only a genuinely live fix pulses. A stale pin that pulses is a lie in a
  // safety product.
  const pulse =
    m.presence === "live"
      ? `<span class="nofikar-pulse" style="border-color:${color}"></span>`
      : "";

  return L.divIcon({
    className: "nofikar-marker",
    html: `
      <div style="position:relative;width:42px;height:42px;${
        m.presence === "offline" ? "opacity:.65;" : ""
      }">
        ${pulse}
        <div style="
          position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
          background:${color};border:3px solid ${selected ? "#111" : "#fff"};border-radius:50%;
          box-shadow:0 2px 8px rgba(0,0,0,.35);overflow:hidden;
        ">${inner}</div>
      </div>`,
    iconSize: [42, 42],
    iconAnchor: [21, 21],
  });
}

export default function MapView({
  members = [],
  zones = [],
  segments = [],
  playbackPosition = null,
  pickerMode = false,
  pickerPosition = null,
  pickerRadius = 200,
  onPick,
  selectedUserId = null,
  onSelectMember,
  followUserId = null,
  focusUserId = null,
  className = "",
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const accuracyRef = useRef<Map<string, L.Circle>>(new Map());
  const zonesRef = useRef<Map<string, L.Circle>>(new Map());
  const zoneLabelsRef = useRef<Map<string, L.Marker>>(new Map());
  const segmentsRef = useRef<L.Polyline[]>([]);
  const playbackRef = useRef<L.Marker | null>(null);
  const pickerRef = useRef<{ marker: L.Marker; circle: L.Circle } | null>(null);

  // Only auto-fit once; afterwards respect the user's pan/zoom.
  const didFitRef = useRef(false);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  // Marker click handlers are registered once per marker, so the latest
  // callback is read through a ref rather than re-binding on every render.
  const onSelectRef = useRef(onSelectMember);
  onSelectRef.current = onSelectMember;
  const lastFocusRef = useRef<string | null>(null);

  // ---- init -------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
      // Keep one-finger drag for the map but let the page scroll past it.
      tap: true,
      preferCanvas: true,
    }).setView([20, 0], 2);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
      maxZoom: 19,
    }).addTo(map);

    L.control.zoom({ position: "topright" }).addTo(map);

    mapRef.current = map;

    // Captured for cleanup: these Map instances are created once and only ever
    // mutated, never reassigned, so holding a reference here is safe and keeps
    // react-hooks/exhaustive-deps satisfied.
    const markers = markersRef.current;
    const accuracy = accuracyRef.current;
    const zoneCircles = zonesRef.current;
    const zoneLabels = zoneLabelsRef.current;

    // Leaflet mis-measures when its container starts hidden or animates in.
    const invalidate = () => map.invalidateSize();
    const t = setTimeout(invalidate, 200);
    window.addEventListener("resize", invalidate);

    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", invalidate);
      map.remove();
      mapRef.current = null;
      markers.clear();
      accuracy.clear();
      zoneCircles.clear();
      zoneLabels.clear();
      segmentsRef.current = [];
      playbackRef.current = null;
      pickerRef.current = null;
      didFitRef.current = false;
    };
  }, []);

  // ---- picker mode ------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!pickerMode) {
      // Tapping empty map dismisses the member detail sheet.
      const dismiss = () => onSelectRef.current?.(null);
      map.on("click", dismiss);
      return () => {
        map.off("click", dismiss);
      };
    }

    const handler = (e: L.LeafletMouseEvent) => {
      onPickRef.current?.(e.latlng.lat, e.latlng.lng);
    };
    map.on("click", handler);
    return () => {
      map.off("click", handler);
    };
  }, [pickerMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!pickerMode || !pickerPosition) {
      if (pickerRef.current) {
        pickerRef.current.marker.remove();
        pickerRef.current.circle.remove();
        pickerRef.current = null;
      }
      return;
    }

    const latlng: L.LatLngExpression = [pickerPosition.lat, pickerPosition.lng];

    if (!pickerRef.current) {
      const marker = L.marker(latlng, {
        icon: L.divIcon({
          className: "nofikar-marker",
          html: `<div style="
            width:20px;height:20px;background:#3d9970;border:3px solid #fff;
            border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,.35)"></div>`,
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        }),
        draggable: true,
      }).addTo(map);

      marker.on("dragend", () => {
        const p = marker.getLatLng();
        onPickRef.current?.(p.lat, p.lng);
      });

      const circle = L.circle(latlng, {
        radius: pickerRadius,
        color: "#3d9970",
        fillColor: "#3d9970",
        fillOpacity: 0.15,
        weight: 2,
      }).addTo(map);

      pickerRef.current = { marker, circle };
      map.setView(latlng, Math.max(map.getZoom(), 15));
    } else {
      pickerRef.current.marker.setLatLng(latlng);
      pickerRef.current.circle.setLatLng(latlng);
      pickerRef.current.circle.setRadius(pickerRadius);
    }
  }, [pickerMode, pickerPosition, pickerRadius]);

  // ---- safe zones -------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const seen = new Set(zones.map((z) => z.id));

    for (const [id, circle] of zonesRef.current) {
      if (!seen.has(id)) {
        circle.remove();
        zonesRef.current.delete(id);
        zoneLabelsRef.current.get(id)?.remove();
        zoneLabelsRef.current.delete(id);
      }
    }

    for (const z of zones) {
      const latlng: L.LatLngExpression = [z.latitude, z.longitude];
      const existing = zonesRef.current.get(z.id);

      if (existing) {
        existing.setLatLng(latlng);
        existing.setRadius(z.radius);
      } else {
        zonesRef.current.set(
          z.id,
          L.circle(latlng, {
            radius: z.radius,
            color: "#2f80ed",
            fillColor: "#2f80ed",
            fillOpacity: 0.1,
            weight: 2,
            dashArray: "6 6",
          })
            .addTo(map)
            .bindPopup(`<strong>${z.name}</strong><br/><span style="font-size:12px;opacity:.8">Radius ${z.radius}m</span>`)
        );
      }

      const label = zoneLabelsRef.current.get(z.id);
      const labelIcon = L.divIcon({
        className: "nofikar-marker",
        html: `<div style="
          transform:translateY(-6px);white-space:nowrap;font-size:11px;font-weight:600;
          color:#2f80ed;background:rgba(255,255,255,.9);padding:2px 6px;border-radius:6px;
          box-shadow:0 1px 3px rgba(0,0,0,.2)">${z.name}</div>`,
        iconSize: [0, 0],
      });
      if (label) {
        label.setLatLng(latlng);
        label.setIcon(labelIcon);
      } else {
        zoneLabelsRef.current.set(
          z.id,
          L.marker(latlng, { icon: labelIcon, interactive: false }).addTo(map)
        );
      }
    }
  }, [zones]);

  // ---- member markers ---------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const seen = new Set(members.map((m) => m.user_id));

    for (const [id, marker] of markersRef.current) {
      if (!seen.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
        accuracyRef.current.get(id)?.remove();
        accuracyRef.current.delete(id);
      }
    }

    for (const m of members) {
      const latlng: L.LatLngExpression = [m.latitude, m.longitude];
      const existing = markersRef.current.get(m.user_id);
      const selected = m.user_id === selectedUserId;

      if (existing) {
        existing.setLatLng(latlng);
        existing.setIcon(memberIcon(m, selected));
      } else {
        const marker = L.marker(latlng, {
          icon: memberIcon(m, selected),
          title: m.name,
          // Keyboard users need to reach the marker to open the detail sheet.
          keyboard: true,
          alt: m.name,
        }).addTo(map);

        // Selection drives a bottom sheet in the page rather than a Leaflet
        // popup: far easier to read and tap on a phone.
        marker.on("click", () => onSelectRef.current?.(m.user_id));
        marker.on("keypress", () => onSelectRef.current?.(m.user_id));

        markersRef.current.set(m.user_id, marker);
      }

      // GPS accuracy halo — communicates uncertainty instead of implying
      // pinpoint precision.
      const halo = accuracyRef.current.get(m.user_id);
      if (halo) {
        halo.setLatLng(latlng);
        halo.setRadius(m.accuracy || 0);
        halo.setStyle({ color: colorFor(m), fillColor: colorFor(m) });
      } else if (m.accuracy) {
        accuracyRef.current.set(
          m.user_id,
          L.circle(latlng, {
            radius: m.accuracy,
            color: colorFor(m),
            fillColor: colorFor(m),
            fillOpacity: 0.08,
            weight: 1,
            interactive: false,
          }).addTo(map)
        );
      }
    }

    if (!didFitRef.current && members.length > 0) {
      didFitRef.current = true;
      if (members.length === 1) {
        map.setView([members[0].latitude, members[0].longitude], 15);
      } else {
        map.fitBounds(
          L.latLngBounds(members.map((m) => [m.latitude, m.longitude] as [number, number])),
          { padding: [48, 48], maxZoom: 16 }
        );
      }
    }
  }, [members, selectedUserId]);

  // ---- follow mode ------------------------------------------------------
  // Re-centres on every new fix for the followed member. Runs off `members` so
  // it tracks live updates rather than only the moment Follow was tapped.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !followUserId) return;

    const target = members.find((m) => m.user_id === followUserId);
    if (!target) return;

    map.setView([target.latitude, target.longitude], Math.max(map.getZoom(), 16), {
      animate: true,
    });
  }, [followUserId, members]);

  // ---- one-shot focus (e.g. from an SOS "View location") ----------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clearing the prop re-arms the effect, so asking to focus the SAME member
    // a second time still recentres instead of being swallowed as a no-op.
    if (!focusUserId) {
      lastFocusRef.current = null;
      return;
    }
    if (lastFocusRef.current === focusUserId) return;

    const target = members.find((m) => m.user_id === focusUserId);
    if (!target) return;

    lastFocusRef.current = focusUserId;
    didFitRef.current = true; // don't let the initial fit fight the focus
    map.setView([target.latitude, target.longitude], 16, { animate: true });
  }, [focusUserId, members]);

  // ---- recorded route ---------------------------------------------------
  // Polylines are rebuilt wholesale rather than diffed: a route changes as one
  // unit when the range or member changes, and the vertex count is already
  // capped upstream by simplifyPath().
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const line of segmentsRef.current) line.remove();
    segmentsRef.current = [];

    for (const segment of segments) {
      if (segment.points.length < 2) continue;

      const line = L.polyline(
        segment.points.map((p) => [p.lat, p.lng] as [number, number]),
        segment.offline
          ? {
              // Amber and dashed: recorded with no connection, synced later.
              color: "#f2994a",
              weight: 4,
              opacity: 0.85,
              dashArray: "8 6",
            }
          : { color: "#3d9970", weight: 4, opacity: 0.7 }
      ).addTo(map);

      if (segment.offline) {
        line.bindPopup(
          '<strong>Offline route</strong><br/><span style="font-size:12px;opacity:.8">Recorded on the device with no connection, then synced.</span>'
        );
      }

      segmentsRef.current.push(line);
    }
  }, [segments]);

  // ---- route playback marker --------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!playbackPosition) {
      playbackRef.current?.remove();
      playbackRef.current = null;
      return;
    }

    const latlng: L.LatLngExpression = [playbackPosition.lat, playbackPosition.lng];

    if (playbackRef.current) {
      playbackRef.current.setLatLng(latlng);
    } else {
      playbackRef.current = L.marker(latlng, {
        interactive: false,
        zIndexOffset: 1000,
        icon: L.divIcon({
          className: "nofikar-marker",
          html: `<div style="
            width:18px;height:18px;background:#2f80ed;border:3px solid #fff;
            border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.4)"></div>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        }),
      }).addTo(map);
    }

    map.panTo(latlng, { animate: true, duration: 0.3 });
  }, [playbackPosition]);

  const recenter = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const me = members.find((m) => m.isMe) ?? members[0];
    if (me) {
      map.setView([me.latitude, me.longitude], 16, { animate: true });
    }
  }, [members]);

  return (
    <div className={`relative ${className}`}>
      <div ref={containerRef} className="absolute inset-0 z-0" />

      {members.length > 0 && (
        <button
          type="button"
          onClick={recenter}
          aria-label="Center map on my location"
          className="absolute bottom-4 right-3 z-[400] h-11 w-11 rounded-full glass-strong shadow-lg flex items-center justify-center active:scale-95 transition-transform"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
        </button>
      )}
    </div>
  );
}
