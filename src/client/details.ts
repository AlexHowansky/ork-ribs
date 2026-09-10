import { FriendlyError, getJson, isAbort } from "./api.ts";
import { h } from "./dom.ts";
import { faIcon } from "./icons.ts";
import { log } from "./log.ts";

export interface EstablishmentDetails {
  id: string;
  name: string;
  address: string;
  city: string | null;
  zip: string | null;
  county: string | null;
  description: string | null;
  inspectionDate: string | null;
  critical: number;
  noncritical: number;
  criticalNotCorrected: number;
  comments: string[];
  violations: { code: string | null; critical: boolean; description: string }[];
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeZone: "UTC" });

function formatDate(iso: string | null): string {
  if (!iso) return "Not recorded";
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? "Not recorded" : dateFormat.format(d);
}

function fullAddress(d: EstablishmentDetails): string {
  const cityLine = [d.city, [ "NY", d.zip ].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [d.address, cityLine].filter(Boolean).join(", ");
}

// Written out in full so Tailwind's source scanner sees each class name. The
// tone colours only a decorative icon: numbers stay in base-content for contrast.
const TONE_CLASS = { error: "text-error", warning: "text-warning", success: "text-success" } as const;
const TONE_ICON = { error: "triangle-exclamation", warning: "circle-info", success: "circle-check" } as const;

function stat(title: string, value: number, desc: string | null, tone: keyof typeof TONE_CLASS): HTMLElement {
  return h(
    "div",
    { class: "stat" },
    h("div", { class: `stat-figure text-3xl ${TONE_CLASS[tone]}` }, faIcon(TONE_ICON[tone])),
    h("div", { class: "stat-title text-base-content/80" }, title),
    h("div", { class: "stat-value" }, value),
    desc ? h("div", { class: "stat-desc text-base-content/80" }, desc) : null,
  );
}

function render(d: EstablishmentDetails): HTMLElement {
  const listedCritical = d.violations.filter((v) => v.critical).length;
  const listedNon = d.violations.length - listedCritical;
  const countsDiffer = listedCritical !== d.critical || listedNon !== d.noncritical;

  const header = h(
    "header",
    { class: "flex flex-col gap-1 pr-10" },
    h("h2", { id: "details-title", class: "text-2xl font-bold" }, d.name),
    h("p", { class: "text-base-content/80" }, fullAddress(d)),
    h(
      "div",
      { class: "flex flex-wrap gap-2 pt-1" },
      d.description ? h("span", { class: "badge badge-outline" }, d.description) : null,
      d.county ? h("span", { class: "badge badge-ghost" }, `${d.county} County`) : null,
    ),
  );

  const stats = h(
    "div",
    { class: "stats stats-vertical w-full bg-base-200 md:stats-horizontal" },
    h(
      "div",
      { class: "stat" },
      h("div", { class: "stat-title text-base-content/80" }, "Last inspection"),
      h("div", { class: "stat-value text-2xl" }, formatDate(d.inspectionDate)),
    ),
    stat(
      "Critical violations",
      d.critical,
      d.criticalNotCorrected > 0 ? `${d.criticalNotCorrected} not corrected during inspection` : null,
      d.critical > 0 ? "error" : "success",
    ),
    stat("Non-critical violations", d.noncritical, null, d.noncritical > 0 ? "warning" : "success"),
  );

  let violations: HTMLElement;
  if (d.violations.length === 0) {
    violations = h(
      "div",
      { role: "status", class: "alert alert-success alert-soft" },
      faIcon("circle-check"),
      h("span", {}, "No violations were found at the last inspection."),
    );
  } else {
    violations = h(
      "ul",
      { class: "grid gap-3 lg:grid-cols-2 2xl:grid-cols-3" },
      ...d.violations.map((v) =>
        h(
          "li",
          { class: "flex flex-col gap-2 rounded-box border border-base-300 bg-base-100 p-3" },
          h(
            "div",
            { class: "flex flex-wrap items-center gap-2" },
            v.code ? h("span", { class: "badge badge-neutral font-mono" }, `Item ${v.code}`) : null,
            h(
              "span",
              { class: `badge ${v.critical ? "badge-error" : "badge-warning"}` },
              faIcon(v.critical ? "triangle-exclamation" : "circle-info"),
              v.critical ? "Critical" : "Non-critical",
            ),
          ),
          h("p", {}, v.description),
        ),
      ),
    );
  }

  return h(
    "div",
    { class: "flex flex-col gap-5" },
    header,
    stats,
    h(
      "section",
      { class: "flex flex-col gap-3", "aria-labelledby": "violations-title" },
      h("h3", { id: "violations-title", class: "text-lg font-semibold" }, `Violations (${d.violations.length})`),
      countsDiffer && d.violations.length > 0
        ? h(
            "p",
            { class: "text-sm text-base-content/70" },
            "The totals above count every instance the inspector recorded; this list shows each violation type once.",
          )
        : null,
      violations,
    ),
    d.comments.length > 0
      ? h(
          "section",
          { class: "flex flex-col gap-2", "aria-labelledby": "notes-title" },
          h("h3", { id: "notes-title", class: "text-lg font-semibold" }, "Inspector’s notes"),
          h("ul", { class: "list-disc pl-5 text-sm text-base-content/80" }, ...d.comments.map((c) => h("li", {}, c))),
        )
      : null,
  );
}

function skeleton(name: string): HTMLElement {
  return h(
    "div",
    { class: "flex flex-col gap-4", "aria-busy": "true" },
    h("h2", { id: "details-title", class: "pr-10 text-2xl font-bold" }, name),
    h("p", { class: "flex items-center gap-2" }, h("span", { class: "loading loading-spinner loading-sm", "aria-hidden": "true" }), "Loading inspection details…"),
    h("div", { class: "skeleton h-24 w-full" }),
    h("div", { class: "skeleton h-40 w-full" }),
  );
}

let inflight: AbortController | null = null;

/** Open the modal for one establishment. `name` is shown straight away while details load. */
export async function openDetails(id: string, name: string): Promise<void> {
  const dialog = document.getElementById("details-dialog") as HTMLDialogElement;
  const content = document.getElementById("details-content")!;
  inflight?.abort();
  const ctrl = new AbortController();
  inflight = ctrl;

  content.replaceChildren(skeleton(name));
  if (!dialog.open) dialog.showModal();
  dialog.addEventListener("close", () => ctrl.abort(), { once: true });

  try {
    const details = await getJson<EstablishmentDetails>(`/api/establishments/${encodeURIComponent(id)}`, { signal: ctrl.signal });
    content.replaceChildren(render(details));
    log.debug("details shown", { id });
  } catch (err) {
    if (isAbort(err)) return;
    const message = err instanceof FriendlyError ? err.message : "We couldn't load this establishment's details. Please try again.";
    if (!(err instanceof FriendlyError)) log.error("details render failed", { id, err: err as Error });
    content.replaceChildren(
      h("h2", { id: "details-title", class: "pr-10 text-2xl font-bold" }, name),
      h("div", { role: "alert", class: "alert alert-error mt-4" }, faIcon("circle-xmark"), h("span", {}, message)),
    );
  } finally {
    if (inflight === ctrl) inflight = null;
  }
}
