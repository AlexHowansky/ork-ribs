import type { Map as MapLibreMap } from "maplibre-gl";
import { FriendlyError, getJson, isAbort } from "./api.ts";
import { h } from "./dom.ts";
import { faIcon } from "./icons.ts";
import { log } from "./log.ts";
import { getUserLocation } from "./map.ts";

interface SearchResult {
  id: string;
  name: string;
  address: string;
  city: string | null;
  lat: number;
  lng: number;
  critical: number;
  noncritical: number;
  distanceKm: number | null;
}

interface SearchResponse {
  query: string;
  total: number;
  sortedBy: "distance" | "name";
  items: SearchResult[];
}

const MIN_LENGTH = 2; // matches the server's SEARCH_MIN_LENGTH
const DEBOUNCE_MS = 250;
const narrowScreen = window.matchMedia("(max-width: 640px)");

// Miles where people measure roads in miles, kilometres elsewhere.
const region = (() => {
  try {
    return new Intl.Locale(navigator.language).maximize().region ?? "US";
  } catch {
    return "US";
  }
})();
const useMiles = ["US", "GB", "LR", "MM"].includes(region);

function formatDistance(km: number): string {
  const value = useMiles ? km / 1.609344 : km;
  return new Intl.NumberFormat(undefined, {
    style: "unit",
    unit: useMiles ? "mile" : "kilometer",
    unitDisplay: "short",
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(value);
}

// Written out in full so Tailwind's source scanner sees each class name.
function tone(r: SearchResult): { badge: string; text: string } {
  if (r.critical > 0) return { badge: "badge-error", text: `${r.critical} critical` };
  if (r.noncritical > 0) return { badge: "badge-warning", text: `${r.noncritical} non-critical` };
  return { badge: "badge-success", text: "No violations" };
}

export interface SearchOptions {
  map: MapLibreMap;
  openDetails: (id: string, name: string) => void;
}

/** Wire up the header search box and the results panel beside the map. */
export function mountSearch({ map, openDetails }: SearchOptions): void {
  const form = document.getElementById("search-form") as HTMLFormElement;
  const input = document.getElementById("search-input") as HTMLInputElement;
  const panel = document.getElementById("search-panel")!;
  const summary = document.getElementById("search-summary")!;
  const list = document.getElementById("search-results")!;
  const closeBtn = document.getElementById("search-close")!;
  const clearBtn = document.getElementById("search-clear")!;
  const details = document.getElementById("details-dialog") as HTMLDialogElement;

  let inflight: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let shown = ""; // the query whose results are in the list
  let returnToMap = false;
  let closing = false; // set while we move focus to the box ourselves, so it doesn't reopen the panel

  function showPanel(): void {
    panel.hidden = false;
  }

  function hidePanel(): void {
    panel.hidden = true;
  }

  function reset(): void {
    inflight?.abort();
    inflight = null;
    shown = "";
    list.replaceChildren();
    summary.textContent = "";
    hidePanel();
  }

  function render(res: SearchResponse, from: "you" | "map"): void {
    const quoted = `“${res.query}”`;
    if (res.total === 0) {
      summary.textContent = `No establishments match ${quoted}. Try fewer letters or a different spelling.`;
      list.replaceChildren();
      return;
    }
    const count = `${res.total.toLocaleString()} ${res.total === 1 ? "match" : "matches"} for ${quoted}`;
    summary.textContent = `${count}, nearest to ${from === "you" ? "your location" : "the centre of the map"} first.`;

    const rows = document.createDocumentFragment();
    for (const r of res.items) {
      const t = tone(r);
      const place = [r.address, r.city].filter(Boolean).join(", ");
      const btn = h(
        "button",
        { type: "button", class: "list-row w-full items-center text-left hover:bg-base-200 focus-visible:bg-base-200" },
        h("span", { class: `badge badge-sm ${t.badge} px-1`, "aria-hidden": "true" }, faIcon("utensils")),
        h(
          "span",
          { class: "flex min-w-0 flex-col" },
          h("span", { class: "font-semibold" }, r.name),
          h("span", { class: "text-sm text-base-content/80" }, place),
          h("span", { class: "text-xs text-base-content/80" }, t.text),
        ),
        r.distanceKm !== null ? h("span", { class: "text-sm whitespace-nowrap text-base-content/80" }, formatDistance(r.distanceKm)) : null,
      );
      btn.addEventListener("click", () => select(r));
      rows.append(h("li", {}, btn));
    }
    list.replaceChildren(rows);
    list.scrollTop = 0;
  }

  function select(r: SearchResult): void {
    log.info("search result chosen", { id: r.id });
    // On a phone the panel covers the map, so step aside; on wider screens keep the list
    // and centre the place in the part of the map the panel doesn't cover.
    const keepPanel = !narrowScreen.matches;
    if (!keepPanel) {
      hidePanel();
      returnToMap = true;
    }
    map.flyTo({
      center: [r.lng, r.lat],
      zoom: Math.max(map.getZoom(), 16),
      padding: { left: keepPanel ? panel.offsetWidth : 0, top: 0, right: 0, bottom: 0 },
    });
    openDetails(r.id, r.name);
  }

  async function run(query: string): Promise<void> {
    inflight?.abort();
    const ctrl = new AbortController();
    inflight = ctrl;
    const user = getUserLocation();
    const near = user ?? { lat: map.getCenter().lat, lng: map.getCenter().lng };
    const params = new URLSearchParams({ q: query, lat: near.lat.toFixed(5), lng: near.lng.toFixed(5) });
    showPanel();
    summary.textContent = `Searching for “${query}”…`;
    try {
      const res = await getJson<SearchResponse>(`/api/search?${params}`, { signal: ctrl.signal });
      shown = query;
      render(res, user ? "you" : "map");
      log.debug("search", { total: res.total });
    } catch (err) {
      if (isAbort(err)) return;
      summary.textContent =
        err instanceof FriendlyError ? err.message : "We couldn't search right now. Please try again in a moment.";
      list.replaceChildren();
      if (!(err instanceof FriendlyError)) log.error("search failed", { err: err as Error });
    } finally {
      if (inflight === ctrl) inflight = null;
    }
  }

  function schedule(immediate: boolean): void {
    clearTimeout(timer);
    const query = input.value.trim();
    if (query.length < MIN_LENGTH) {
      reset();
      return;
    }
    if (query === shown && !inflight) {
      showPanel();
      return;
    }
    if (immediate) void run(query);
    else timer = setTimeout(() => void run(query), DEBOUNCE_MS);
  }

  input.addEventListener("input", () => {
    clearBtn.hidden = input.value === "";
    schedule(false);
  });
  function clear(): void {
    input.value = "";
    clearBtn.hidden = true;
    clearTimeout(timer);
    reset();
  }
  clearBtn.addEventListener("click", () => {
    clear();
    closing = true;
    input.focus();
    closing = false;
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && input.value !== "") {
      e.preventDefault();
      clear();
    }
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    schedule(true);
  });
  // Coming back to the box reopens the last results (but not when we moved focus there ourselves on close).
  input.addEventListener("focus", () => {
    if (!closing && shown && input.value.trim() === shown) showPanel();
  });

  function closePanel(): void {
    hidePanel();
    closing = true;
    input.focus();
    closing = false;
  }
  closeBtn.addEventListener("click", closePanel);
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePanel();
  });

  // On a phone the result that opened the details is now hidden with the panel, so the
  // dialog can't hand focus back to it; send focus to the map, where the place now is.
  // (Not the search box: that would pop up the keyboard and cover the map again.)
  details.addEventListener("close", () => {
    if (returnToMap) {
      returnToMap = false;
      document.getElementById("map")?.focus({ preventScroll: true });
    }
  });
}
