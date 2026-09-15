export interface GeocodeResult {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
}

/**
 * Forward geocoding via Nominatim (OpenStreetMap). Free and key-less, matching
 * the OSM tiles the map already uses.
 *
 * Nominatim's usage policy caps automated traffic at roughly one request per
 * second, so callers must debounce. `signal` lets a newer keystroke abort an
 * in-flight request rather than racing it.
 */
export async function searchPlaces(
  query: string,
  signal?: AbortSignal
): Promise<GeocodeResult[]> {
  const q = query.trim();
  if (q.length < 3) return [];

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "6");
  url.searchParams.set("addressdetails", "1");

  const res = await fetch(url.toString(), {
    signal,
    headers: { Accept: "application/json" },
  });

  if (!res.ok) throw new Error("Place search is unavailable right now.");

  const raw = (await res.json()) as Array<{
    place_id: number;
    display_name: string;
    lat: string;
    lon: string;
  }>;

  return raw.map((r) => ({
    id: String(r.place_id),
    label: r.display_name,
    latitude: Number(r.lat),
    longitude: Number(r.lon),
  }));
}

/**
 * Reverse geocoding, used to suggest a name once a pin is dropped on the map.
 * Returns null rather than throwing: a missing suggestion is not an error.
 */
export async function describeLocation(
  latitude: number,
  longitude: number,
  signal?: AbortSignal
): Promise<string | null> {
  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", String(latitude));
    url.searchParams.set("lon", String(longitude));
    url.searchParams.set("zoom", "18");

    const res = await fetch(url.toString(), {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      name?: string;
      address?: Record<string, string>;
    };

    const a = data.address ?? {};
    return (
      data.name?.trim() ||
      a.amenity ||
      a.building ||
      a.road ||
      a.suburb ||
      a.neighbourhood ||
      a.city ||
      null
    );
  } catch {
    return null;
  }
}
