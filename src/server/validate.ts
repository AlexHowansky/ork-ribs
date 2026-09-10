import { Errors } from "./errors.ts";

export interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

const NUMBER = /^-?\d{1,3}(\.\d{1,10})?$/;

/** Parse `bbox=west,south,east,north`; throws a friendly 400 on anything odd. */
export function parseBBox(raw: string | null): BBox {
  const bad = Errors.badRequest("The map area we were asked to search wasn't valid. Try moving the map a little.");
  if (!raw || raw.length > 120) throw bad;
  const parts = raw.split(",");
  if (parts.length !== 4 || !parts.every((p) => NUMBER.test(p))) throw bad;
  const [west, south, east, north] = parts.map(Number) as [number, number, number, number];
  if (west < -180 || east > 180 || south < -90 || north > 90) throw bad;
  if (!(west < east) || !(south < north)) throw bad;
  return { west, south, east, north };
}

export function parseZoom(raw: string | null): number {
  if (raw === null || !/^\d{1,2}(\.\d{1,6})?$/.test(raw)) {
    throw Errors.badRequest("The map zoom level wasn't valid. Try zooming the map a little.");
  }
  const z = Number(raw);
  if (z < 0 || z > 24) throw Errors.badRequest("The map zoom level wasn't valid. Try zooming the map a little.");
  return z;
}

/** Establishment ids are NYS Health operation ids, which are numeric (e.g. `252181`). */
export function parseEstablishmentId(raw: string | undefined): string {
  if (!raw || !/^\d{1,12}$/.test(raw)) throw Errors.notFound("We couldn't find that establishment.");
  return raw;
}

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 100;

/** A name search: at least two characters once trimmed, and not absurdly long. */
export function parseSearchQuery(raw: string | null): string {
  const q = (raw ?? "").trim();
  if (q.length < SEARCH_MIN_LENGTH) throw Errors.badRequest(`Type at least ${SEARCH_MIN_LENGTH} letters of a name to search.`);
  if (q.length > SEARCH_MAX_LENGTH) throw Errors.badRequest(`Search for a name of at most ${SEARCH_MAX_LENGTH} characters.`);
  return q;
}

/** An optional reference point for sorting (`lat` and `lng` together, or neither). */
export function parseNear(lat: string | null, lng: string | null): { lat: number; lng: number } | undefined {
  if (lat === null && lng === null) return undefined;
  const bad = Errors.badRequest("We couldn't tell where to sort results from. Try searching again.");
  if (lat === null || lng === null || !NUMBER.test(lat) || !NUMBER.test(lng)) throw bad;
  const point = { lat: Number(lat), lng: Number(lng) };
  if (Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) throw bad;
  return point;
}

/** NY State bounds, slightly padded. */
export const NY_BOUNDS: BBox = { west: -79.8, south: 40.45, east: -71.8, north: 45.05 };

/** The five boroughs of New York City, which inspect restaurants themselves and aren't in the NYS dataset. */
export const NYC_BOUNDS: BBox = { west: -74.26, south: 40.49, east: -73.69, north: 40.92 };

export function intersects(a: BBox, b: BBox): boolean {
  return a.west < b.east && b.west < a.east && a.south < b.north && b.south < a.north;
}

export function contains(outer: BBox, inner: BBox): boolean {
  return inner.west >= outer.west && inner.east <= outer.east && inner.south >= outer.south && inner.north <= outer.north;
}
