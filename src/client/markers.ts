import { LngLatBounds, Marker, type Map as MapLibreMap } from "maplibre-gl";
import { faIcon } from "./icons.ts";

export interface PointItem {
  id: string;
  name: string;
  lat: number;
  lng: number;
  critical: number;
  noncritical: number;
}

export interface ClusterItem {
  count: number;
  id: string | null;
  name: string | null;
  critical: number;
  noncritical: number;
  lat: number;
  lng: number;
  west: number;
  south: number;
  east: number;
  north: number;
  withCritical: number;
}

export type EstablishmentsResponse =
  | { mode: "points"; total: number; notice: Notice; items: PointItem[] }
  | { mode: "clusters"; total: number; notice: Notice; items: ClusterItem[] };

export type Notice = "outside-ny" | "nyc" | "empty" | null;

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

function statusClass(p: { critical: number; noncritical: number }): string {
  if (p.critical > 0) return "btn-error";
  if (p.noncritical > 0) return "btn-warning";
  return "btn-success";
}

function pointLabel(p: { name: string; critical: number; noncritical: number }): string {
  return `${p.name}: ${plural(p.critical, "critical violation", "critical violations")} and ${plural(
    p.noncritical,
    "non-critical violation",
    "non-critical violations",
  )}. Open inspection details.`;
}

function abbreviate(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
}

/**
 * Keeps one HTML marker per establishment or cluster on the map, reusing the
 * ones that are still in view on each update rather than rebuilding them all.
 * Markers are real <button>s so they can be reached with the keyboard.
 */
export class MarkerLayer {
  private markers = new Map<string, Marker>();

  constructor(
    private readonly map: MapLibreMap,
    private readonly onOpen: (id: string, name: string) => void,
  ) {}

  update(res: EstablishmentsResponse): void {
    const next = new Map<string, () => HTMLElement>();
    const positions = new Map<string, [number, number]>();

    if (res.mode === "points") {
      for (const p of res.items) {
        const key = `p:${p.id}`;
        next.set(key, () => this.pointElement(p));
        positions.set(key, [p.lng, p.lat]);
      }
    } else {
      for (const c of res.items) {
        if (c.count === 1 && c.id && c.name) {
          const p = { id: c.id, name: c.name, critical: c.critical, noncritical: c.noncritical };
          const key = `p:${c.id}`;
          next.set(key, () => this.pointElement(p));
          positions.set(key, [c.lng, c.lat]);
        } else {
          const key = `c:${c.west},${c.south},${c.east},${c.north},${c.count}`;
          next.set(key, () => this.clusterElement(c));
          positions.set(key, [c.lng, c.lat]);
        }
      }
    }

    for (const [key, marker] of this.markers) {
      if (!next.has(key)) {
        marker.remove();
        this.markers.delete(key);
      }
    }
    for (const [key, make] of next) {
      if (this.markers.has(key)) continue;
      // MapLibre positions the marker element with an inline transform; keep the
      // styled button inside a bare wrapper so button styles can't disturb that.
      const wrapper = document.createElement("div");
      wrapper.append(make());
      const marker = new Marker({ element: wrapper, anchor: "center" }).setLngLat(positions.get(key)!).addTo(this.map);
      this.markers.set(key, marker);
    }
  }

  clear(): void {
    for (const m of this.markers.values()) m.remove();
    this.markers.clear();
  }

  private pointElement(p: { id: string; name: string; critical: number; noncritical: number }): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `btn btn-circle btn-sm shadow-md ring-2 ring-base-100 ${statusClass(p)}`;
    btn.setAttribute("aria-label", pointLabel(p));
    btn.title = p.name;
    btn.append(faIcon("utensils"));
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.onOpen(p.id, p.name);
    });
    return btn;
  }

  private clusterElement(c: ClusterItem): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    const size = c.count < 10 ? "btn-sm" : c.count < 100 ? "btn-md" : "btn-lg";
    btn.className = `btn btn-circle btn-primary shadow-md ring-2 ring-base-100 ${size}`;
    const critical = c.withCritical > 0 ? `, ${plural(c.withCritical, "with critical violations", "with critical violations")}` : "";
    btn.setAttribute("aria-label", `${plural(c.count, "establishment", "establishments")}${critical}. Zoom in to see them.`);
    btn.title = `${c.count.toLocaleString()} establishments — select to zoom in`;
    btn.textContent = abbreviate(c.count);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.map.fitBounds(new LngLatBounds([c.west, c.south], [c.east, c.north]), { padding: 80, maxZoom: 17 });
    });
    return btn;
  }
}
