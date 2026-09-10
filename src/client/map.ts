import { Map as MapLibreMap, Marker, setWorkerUrl, type LngLatBoundsLike } from "maplibre-gl";
import { log } from "./log.ts";
import type { ThemeName } from "./theme.ts";
import { toast } from "./toast.ts";

// Served from our own origin (see src/server/build.ts) so the CSP can stay strict.
setWorkerUrl("/vendor/maplibre/maplibre-gl-worker.mjs");

const BASEMAP: Record<ThemeName, string> = {
  winter: "https://tiles.openfreemap.org/styles/liberty",
  night: "https://tiles.openfreemap.org/styles/dark",
};

/** New York State, shown when the reader's location isn't available. */
export const NY_STATE_BOUNDS: LngLatBoundsLike = [
  [-79.77, 40.49],
  [-71.85, 45.02],
];

export function createMap(container: HTMLElement, theme: ThemeName): MapLibreMap {
  const map = new MapLibreMap({
    container,
    style: BASEMAP[theme],
    bounds: NY_STATE_BOUNDS,
    fitBoundsOptions: { padding: 24 },
    minZoom: 3,
    maxZoom: 19,
    attributionControl: false, // rendered in the page, styled with the theme
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
  });
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();

  let warned = false;
  map.on("error", (e) => {
    log.warn("map error", { err: e.error });
    if (!warned) {
      warned = true;
      toast("Part of the map background didn't load. Restaurant markers still work; try reloading if the map looks blank.", "warning");
    }
  });
  return map;
}

export function setBasemap(map: MapLibreMap, theme: ThemeName): void {
  // Markers are HTML elements outside the style, so swapping the whole style loses nothing.
  map.setStyle(BASEMAP[theme]);
}

/** The visible area as the API's `bbox=west,south,east,north` parameter. */
export function viewportQuery(map: MapLibreMap): string {
  const b = map.getBounds();
  const clampLng = (v: number) => Math.max(-180, Math.min(180, v)).toFixed(5);
  const clampLat = (v: number) => Math.max(-85, Math.min(85, v)).toFixed(5);
  const bbox = [clampLng(b.getWest()), clampLat(b.getSouth()), clampLng(b.getEast()), clampLat(b.getNorth())].join(",");
  return new URLSearchParams({ bbox, zoom: map.getZoom().toFixed(2) }).toString();
}

const GEO_MESSAGES: Record<number, string> = {
  1: "Location access is turned off, so we're showing all of New York State. Allow location access and choose “Locate me” to jump to where you are.",
  2: "We couldn't work out where you are, so we're showing all of New York State.",
  3: "Finding your location took too long, so we're showing all of New York State. Choose “Locate me” to try again.",
};

let userMarker: Marker | null = null;
let userLocation: { lat: number; lng: number } | null = null;

/** Where the reader is, if they've let us locate them this visit. */
export function getUserLocation(): { lat: number; lng: number } | null {
  return userLocation;
}

/** Centre the map on the reader. Resolves true on success; on failure explains why and leaves the map where it is. */
export function locateUser(map: MapLibreMap): Promise<boolean> {
  if (!("geolocation" in navigator)) {
    toast("Your browser can't share your location, so we're showing all of New York State.", "info");
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const center: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        log.info("located user", { accuracyM: Math.round(pos.coords.accuracy) });
        if (!userMarker) {
          const dot = document.createElement("div");
          dot.className = "size-4 rounded-full border-2 border-base-100 bg-info shadow-md";
          dot.setAttribute("role", "img");
          dot.setAttribute("aria-label", "Your location");
          userMarker = new Marker({ element: dot });
        }
        userMarker.setLngLat(center).addTo(map);
        map.flyTo({ center, zoom: 15 });
        resolve(true);
      },
      (err) => {
        log.info("geolocation unavailable", { code: err.code });
        toast(GEO_MESSAGES[err.code] ?? GEO_MESSAGES[2]!, "info");
        resolve(false);
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  });
}
