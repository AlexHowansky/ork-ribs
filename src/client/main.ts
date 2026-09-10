import "maplibre-gl/dist/maplibre-gl.css";
import { FriendlyError, getJson, isAbort } from "./api.ts";
import { confirmAction } from "./confirm.ts";
import { openDetails } from "./details.ts";
import { hydrateIcons } from "./icons.ts";
import { installGlobalErrorLogging, log } from "./log.ts";
import { createMap, locateUser, setBasemap, viewportQuery } from "./map.ts";
import { MarkerLayer, type EstablishmentsResponse, type Notice } from "./markers.ts";
import { mountSearch } from "./search.ts";
import { effectiveTheme, mountThemeControl, onThemeChange, setPref } from "./theme.ts";
import { toast } from "./toast.ts";

installGlobalErrorLogging();
hydrateIcons();
mountThemeControl(document.getElementById("theme-control")!);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// The legend remembers whether the reader folded it away. With no saved choice
// it starts open, except on narrow screens where it would cover the map.
const LEGEND_KEY = "ork-legend";
const legend = $<HTMLDetailsElement>("legend");
const legendOpenByDefault = () => !window.matchMedia("(max-width: 640px)").matches;
function applyLegendDefault(): void {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(LEGEND_KEY);
  } catch {
    /* storage unavailable */
  }
  legend.open = saved ? saved === "open" : legendOpenByDefault();
}
applyLegendDefault();
legend.addEventListener("toggle", () => {
  // Only a departure from the default is a choice worth remembering.
  try {
    if (legend.open === legendOpenByDefault()) localStorage.removeItem(LEGEND_KEY);
    else localStorage.setItem(LEGEND_KEY, legend.open ? "open" : "closed");
  } catch {
    /* storage unavailable: the choice just isn't remembered */
  }
});

const statusText = $("status-text");
const spinner = $("status-spinner");
const notice = $("notice");
const noticeText = $("notice-text");

const NOTICES: Record<Exclude<Notice, null>, string> = {
  nyc: "New York City restaurants aren't in the state's inspection data — the city inspects them itself. Move the map outside the five boroughs to see results.",
  "outside-ny": "This guide covers New York State. Move the map back to New York to see restaurants.",
  empty: "No inspected establishments in this area. Try zooming out or moving the map.",
};

function setNotice(n: Notice): void {
  notice.hidden = n === null;
  if (n) noticeText.textContent = NOTICES[n];
}

function setStatus(text: string, loading: boolean): void {
  statusText.textContent = text;
  spinner.hidden = !loading;
}

const map = createMap($("map"), effectiveTheme());
const markers = new MarkerLayer(map, (id, name) => void openDetails(id, name));
mountSearch({ map, openDetails: (id, name) => void openDetails(id, name) });
onThemeChange((theme) => setBasemap(map, theme));

let inflight: AbortController | null = null;
let debounce: ReturnType<typeof setTimeout> | undefined;
let shownQuery = "";

async function loadViewport(): Promise<void> {
  const query = viewportQuery(map);
  if (query === shownQuery && !inflight) return; // e.g. a moveend that ended where it started
  inflight?.abort();
  const ctrl = new AbortController();
  inflight = ctrl;
  setStatus("Searching this area…", true);
  log.debug("loading viewport", { query });
  try {
    const res = await getJson<EstablishmentsResponse>(`/api/establishments?${query}`, { signal: ctrl.signal });
    markers.update(res);
    shownQuery = query;
    setNotice(res.notice);
    const n = res.total.toLocaleString();
    setStatus(
      res.mode === "points"
        ? `${n} ${res.total === 1 ? "establishment" : "establishments"} in view`
        : `${n} establishments in view — zoom in to see each one`,
      false,
    );
  } catch (err) {
    if (isAbort(err)) return;
    setStatus("Couldn't load this area", false);
    toast(err instanceof FriendlyError ? err.message : "We couldn't load restaurants for this area. Please try again in a moment.", "error");
    if (!(err instanceof FriendlyError)) log.error("viewport load failed", { err: err as Error });
  } finally {
    if (inflight === ctrl) inflight = null;
  }
}

map.on("load", () => {
  void loadViewport();
  void locateUser(map);
});
map.on("moveend", () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => void loadViewport(), 250);
});

$("zoom-in").addEventListener("click", () => map.zoomIn());
$("zoom-out").addEventListener("click", () => map.zoomOut());

const locateBtn = $<HTMLButtonElement>("locate-btn");
locateBtn.addEventListener("click", async () => {
  locateBtn.disabled = true;
  try {
    await locateUser(map);
  } finally {
    locateBtn.disabled = false;
  }
});

$("reset-btn").addEventListener("click", async () => {
  const ok = await confirmAction({
    title: "Reset your preferences?",
    body: "This forgets the colour theme and legend choices saved on this device. The theme goes back to following your system’s light or dark setting. Your previous choices can’t be restored.",
    actionLabel: "Reset preferences",
  });
  if (!ok) return;
  setPref("system");
  try {
    localStorage.removeItem(LEGEND_KEY);
  } catch {
    /* nothing saved */
  }
  applyLegendDefault();
  log.info("preferences reset");
  toast("Your preferences have been reset.", "success");
});

void (async () => {
  try {
    const meta = await getJson<{ establishments: number; sourceLastModified: string | null }>("/api/meta");
    const updated = meta.sourceLastModified ? new Date(meta.sourceLastModified) : null;
    $("data-updated").textContent =
      updated && !Number.isNaN(updated.getTime())
        ? `, updated ${updated.toLocaleDateString(undefined, { dateStyle: "medium" })}`
        : " (loading)";
  } catch (err) {
    log.warn("meta load failed", { err: err as Error });
  }
})();
