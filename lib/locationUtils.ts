import { ActivityStatus } from '@/types';

export function calculateSpeed(
  speed: number | null,
  prevLat?: number,
  prevLon?: number,
  currLat?: number,
  currLon?: number,
  timeDiff?: number
): number {
  // Use GPS speed if available (meters/second)
  if (speed !== null && speed >= 0) {
    return speed * 3.6; // Convert to km/h
  }

  // Fallback: calculate from position change
  if (prevLat && prevLon && currLat && currLon && timeDiff && timeDiff > 0) {
    const distance = getDistanceInMeters(prevLat, prevLon, currLat, currLon);
    const speedMs = distance / (timeDiff / 1000);
    return speedMs * 3.6; // Convert to km/h
  }

  return 0;
}

export function getDistanceInMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

export function getActivityStatus(speedKmh: number): ActivityStatus {
  if (speedKmh < 2) {
    return {
      icon: '🟢',
      label: 'Stationary',
      color: 'text-green-600',
    };
  } else if (speedKmh < 25) {
    return {
      icon: '🚶',
      label: 'Walking',
      color: 'text-blue-600',
    };
  } else {
    return {
      icon: '🚗',
      label: 'Driving',
      color: 'text-orange-600',
    };
  }
}

export function getTimeAgo(timestamp: string): string {
  const now = new Date().getTime();
  const time = new Date(timestamp).getTime();
  const diff = Math.floor((now - time) / 1000);

  if (diff < 5) return 'Just now';
  if (diff < 60) return `${diff} seconds ago`;
  if (diff < 120) return '1 minute ago';
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
  if (diff < 7200) return '1 hour ago';
  return `${Math.floor(diff / 3600)} hours ago`;
}

/**
 * Battery level 0-100, or null when the Battery Status API is unavailable.
 * Chromium-only in practice (Safari and Firefox do not implement it), so every
 * caller must treat null as "unknown" rather than showing a fake value.
 */
export async function readBatteryLevel(): Promise<number | null> {
  try {
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<{ level: number }>;
    };
    if (typeof nav.getBattery !== 'function') return null;
    const battery = await nav.getBattery();
    return Math.round(battery.level * 100);
  } catch {
    // Unsupported or blocked by permissions policy — battery is optional.
    return null;
  }
}
