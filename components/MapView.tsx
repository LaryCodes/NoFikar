"use client";

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface MapViewProps {
  latitude: number;
  longitude: number;
  trail?: Array<{ lat: number; lng: number }>;
}

export default function MapView({ latitude, longitude, trail = [] }: MapViewProps) {
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const trailRef = useRef<L.Polyline | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Initialize map
    if (!mapRef.current) {
      mapRef.current = L.map(containerRef.current).setView([latitude, longitude], 15);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(mapRef.current);

      // Custom marker icon
      const customIcon = L.divIcon({
        className: 'custom-marker',
        html: `<div style="
          width: 32px;
          height: 32px;
          background: #3b82f6;
          border: 4px solid white;
          border-radius: 50%;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          animation: pulse 2s infinite;
        "></div>
        <style>
          @keyframes pulse {
            0%, 100% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.1); opacity: 0.8; }
          }
        </style>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      markerRef.current = L.marker([latitude, longitude], { icon: customIcon }).addTo(
        mapRef.current
      );
    }

    // Update marker position
    if (markerRef.current) {
      markerRef.current.setLatLng([latitude, longitude]);
      mapRef.current?.setView([latitude, longitude], mapRef.current.getZoom());
    }

    // Update trail
    if (trail.length > 1) {
      if (trailRef.current) {
        trailRef.current.setLatLngs(trail);
      } else {
        trailRef.current = L.polyline(trail, {
          color: '#8b5cf6',
          weight: 3,
          opacity: 0.7,
        }).addTo(mapRef.current!);
      }
    }
  }, [latitude, longitude, trail]);

  return (
    <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
      <div
        ref={containerRef}
        className="w-full h-[400px] md:h-[500px]"
        style={{ zIndex: 0 }}
      />
    </div>
  );
}
