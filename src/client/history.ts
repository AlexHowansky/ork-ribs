import { Chart, Legend, LinearScale, LineController, LineElement, PointElement, Tooltip, type ChartConfiguration } from "chart.js";
import { FriendlyError, getJson, isAbort } from "./api.ts";
import { h } from "./dom.ts";
import { faIcon } from "./icons.ts";
import { log } from "./log.ts";
import { onThemeChange } from "./theme.ts";

Chart.register(LineController, LineElement, PointElement, LinearScale, Tooltip, Legend);

export interface Inspection {
  date: string;
  critical: number;
  noncritical: number;
}

type HistoryResult = { ok: true; inspections: Inspection[] } | { ok: false; message: string } | { ok: false; aborted: true };

const DAY_MS = 86_400_000;
const longDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });
const monthYear = new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
const yearOnly = new Intl.DateTimeFormat(undefined, { year: "numeric", timeZone: "UTC" });

const toMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** Fetch the history, turning every failure into a message rather than a rejection. */
async function loadHistory(id: string, signal: AbortSignal): Promise<HistoryResult> {
  try {
    const body = await getJson<{ inspections: Inspection[] }>(`/api/establishments/${encodeURIComponent(id)}/history`, { signal });
    return { ok: true, inspections: body.inspections };
  } catch (err) {
    if (isAbort(err)) return { ok: false, aborted: true };
    if (!(err instanceof FriendlyError)) log.error("history load failed", { id, err: err as Error });
    return { ok: false, message: err instanceof FriendlyError ? err.message : "We couldn't load the inspection history. Please try again." };
  }
}

/**
 * Canvas can't read CSS variables, so resolve a daisyUI token to the colour the
 * active theme gives it by painting one pixel and reading it back. The result
 * is always the theme's own colour, never a shade picked here.
 */
let probe: CanvasRenderingContext2D | null = null;
function tokenColor(token: string, alpha = 1): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--color-${token}`).trim();
  probe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!probe) return value;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = value;
  probe.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = probe.getImageData(0, 0, 1, 1).data;
  return "#" + [r, g, b, Math.round(alpha * 255)].map((n) => n.toString(16).padStart(2, "0")).join("");
}

/** Months between ticks, chosen so there are never more than about eight. */
function tickStep(min: number, max: number): number {
  const months = (max - min) / (30.44 * DAY_MS);
  return [1, 3, 6, 12, 24, 36, 60].find((s) => months / s <= 8) ?? 60;
}

/** Ticks on the first of a month, every `step` months (on year boundaries once `step` is a year or more). */
function dateTicks(min: number, max: number, step: number): number[] {
  const start = new Date(min);
  let month = start.getUTCFullYear() * 12 + start.getUTCMonth();
  if (Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1) < min) month++;
  month = Math.ceil(month / step) * step;
  const ticks: number[] = [];
  for (;;) {
    const t = Date.UTC(Math.floor(month / 12), month % 12, 1);
    if (t > max) return ticks;
    ticks.push(t);
    month += step;
  }
}

function themed(config: ChartConfiguration<"line", { x: number; y: number }[]>): void {
  const ink = tokenColor("base-content");
  const muted = tokenColor("base-content", 0.75);
  const grid = tokenColor("base-content", 0.1);
  const surface = tokenColor("base-100");
  const [crit, non] = config.data.datasets;
  for (const [ds, token] of [
    [crit!, "error"],
    [non!, "warning"],
  ] as const) {
    const c = tokenColor(token);
    Object.assign(ds, { borderColor: c, backgroundColor: c, pointBackgroundColor: c, pointHoverBackgroundColor: c, pointBorderColor: surface, pointHoverBorderColor: surface });
  }
  const { x, y } = config.options!.scales!;
  for (const axis of [x!, y!]) {
    axis.grid = { ...axis.grid, color: grid };
    axis.border = { ...axis.border, color: grid };
    axis.ticks = { ...axis.ticks, color: muted };
  }
  y!.title = { ...y!.title, color: muted };
  const plugins = config.options!.plugins!;
  plugins.legend!.labels = { ...plugins.legend!.labels, color: ink };
  Object.assign(plugins.tooltip!, {
    backgroundColor: tokenColor("base-200"),
    borderColor: tokenColor("base-300"),
    titleColor: ink,
    bodyColor: ink,
  });
}

let chart: Chart<"line", { x: number; y: number }[]> | null = null;
let drawn: { canvas: HTMLCanvasElement; items: Inspection[] } | null = null;

// Colours are resolved when the chart is made, so a theme change redraws it in the new theme's tokens.
onThemeChange(() => {
  if (drawn) drawChart(drawn.canvas, drawn.items, false);
});

/** Release the chart before the modal's content is replaced or the modal closes. */
export function destroyHistoryChart(): void {
  chart?.destroy();
  chart = null;
  drawn = null;
}

function drawChart(canvas: HTMLCanvasElement, items: Inspection[], animate = true): void {
  const points = items.map((i) => ({ t: toMs(i.date), ...i }));
  let min = points[0]!.t;
  let max = points.at(-1)!.t;
  // A single inspection still gets a readable year either side of it; otherwise pad so edge points aren't clipped.
  const pad = max === min ? 182 * DAY_MS : Math.max((max - min) * 0.03, 15 * DAY_MS);
  min -= pad;
  max += pad;
  const step = tickStep(min, max);
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;

  const config: ChartConfiguration<"line", { x: number; y: number }[]> = {
    type: "line",
    data: {
      datasets: [
        { label: "Critical", data: points.map((p) => ({ x: p.t, y: p.critical })), pointStyle: "triangle", pointRadius: 6, pointHoverRadius: 8 },
        { label: "Non-critical", data: points.map((p) => ({ x: p.t, y: p.noncritical })), pointStyle: "circle", pointRadius: 5, pointHoverRadius: 7 },
      ].map((d) => ({ ...d, borderWidth: 2, pointBorderWidth: 2, tension: 0 })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? { duration: 300 } : false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          type: "linear",
          min,
          max,
          afterBuildTicks: (scale) => {
            scale.ticks = dateTicks(min, max, step).map((value) => ({ value }));
          },
          ticks: {
            maxRotation: 0,
            callback: (value) => (step >= 12 ? yearOnly : monthYear).format(Number(value)),
          },
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: { precision: 0 },
          title: { display: true, text: "Violations" },
        },
      },
      plugins: {
        legend: { position: "top", align: "start", labels: { usePointStyle: true, boxHeight: 8, padding: 16 } },
        tooltip: {
          usePointStyle: true,
          borderWidth: 1,
          padding: 10,
          callbacks: { title: (ctx) => (ctx[0] ? longDate.format(ctx[0].parsed.x!) : "") },
        },
      },
    },
  };
  themed(config);
  destroyHistoryChart();
  chart = new Chart(canvas, config);
  drawn = { canvas, items };
}

function table(items: Inspection[]): HTMLElement {
  return h(
    "details",
    { class: "text-sm" },
    h("summary", { class: "cursor-pointer select-none text-base-content/80" }, "Show as a table"),
    h(
      "div",
      { class: "max-h-72 overflow-y-auto pt-2" },
      h(
        "table",
        { class: "table table-sm table-pin-rows" },
        h("caption", { class: "sr-only" }, "Violations found at each inspection, newest first"),
        h(
          "thead",
          {},
          h("tr", {}, h("th", { scope: "col" }, "Inspection date"), h("th", { scope: "col", class: "text-right" }, "Critical"), h("th", { scope: "col", class: "text-right" }, "Non-critical")),
        ),
        h(
          "tbody",
          {},
          ...items
            .slice()
            .reverse()
            .map((i) =>
              h(
                "tr",
                {},
                h("td", {}, longDate.format(toMs(i.date))),
                h("td", { class: "text-right tabular-nums" }, i.critical),
                h("td", { class: "text-right tabular-nums" }, i.noncritical),
              ),
            ),
        ),
      ),
    ),
  );
}

function loading(): HTMLElement[] {
  return [
    h("p", { class: "flex items-center gap-2 text-sm" }, h("span", { class: "loading loading-spinner loading-xs", "aria-hidden": "true" }), "Loading earlier inspections…"),
    h("div", { class: "skeleton mt-2 h-64 w-full" }),
  ];
}

/** Fill `panel` with the chart and table. The panel must be showing so the chart can size itself. */
function showInspections(panel: HTMLElement, items: Inspection[]): void {
  if (items.length === 0) {
    panel.replaceChildren(
      h("div", { role: "status", class: "alert alert-info alert-soft" }, faIcon("circle-info"), h("span", {}, "The state has no earlier inspections on record for this establishment.")),
    );
    return;
  }

  const first = longDate.format(toMs(items[0]!.date));
  const last = longDate.format(toMs(items.at(-1)!.date));
  const span = items.length === 1 ? `one inspection, on ${first}` : `${items.length} inspections from ${first} to ${last}`;
  const canvas = h("canvas", {
    role: "img",
    "aria-label": `Line chart of critical and non-critical violations found at ${span}. The same figures are in the table below.`,
  });
  panel.replaceChildren(
    h("p", { class: "text-sm text-base-content/80" }, `Violations found at each of ${span}.`),
    h("div", { class: "relative mt-2 h-64 w-full" }, canvas),
    table(items),
  );
  try {
    drawChart(canvas, items);
  } catch (err) {
    log.error("history chart failed", { err: err as Error });
    canvas.parentElement!.replaceWith(
      h("div", { role: "alert", class: "alert alert-warning alert-soft" }, faIcon("circle-info"), h("span", {}, "We couldn't draw the chart, but the figures are in the table below.")),
    );
  }
}

/**
 * The history tab's panel. Nothing is fetched until `activate` is called (when
 * the tab is first shown); after that the result is kept, except a failure,
 * which the reader can retry. Aborting `signal` abandons any request in flight.
 */
export function historyPanel(id: string, signal: AbortSignal): { panel: HTMLElement; activate: () => void } {
  const panel = h("div", { class: "flex flex-col gap-3" });
  let state: "idle" | "loading" | "done" = "idle";

  async function load(): Promise<void> {
    state = "loading";
    panel.setAttribute("aria-busy", "true");
    panel.replaceChildren(...loading());
    const result = await loadHistory(id, signal);
    if (!result.ok && "aborted" in result) return;
    panel.removeAttribute("aria-busy");
    if (result.ok) {
      state = "done";
      showInspections(panel, result.inspections);
      log.debug("history shown", { id, inspections: result.inspections.length });
      return;
    }
    state = "idle";
    const retry = h("button", { type: "button", class: "btn btn-sm" }, faIcon("rotate-left"), h("span", {}, "Try again"));
    retry.addEventListener("click", () => void load());
    panel.replaceChildren(h("div", { role: "alert", class: "alert alert-warning alert-soft" }, faIcon("circle-info"), h("span", {}, result.message), retry));
  }

  return {
    panel,
    activate: () => {
      if (state === "idle") void load();
    },
  };
}
