/**
 * Mirror the NYS "Food Service Establishment: Last Inspection" dataset into SQLite.
 * https://health.data.ny.gov/Health/Food-Service-Establishment-Last-Inspection/cnih-y5dw
 */
import type { NewEstablishment, Store } from "./db.ts";
import { log as rootLog, type Logger } from "./log.ts";
import { NY_BOUNDS } from "./validate.ts";
import { parseViolations } from "./violations.ts";

/** Fixed upstream endpoint; nothing user-supplied ever reaches this URL (no SSRF surface). */
export const DATASET_URL = "https://health.data.ny.gov/resource/cnih-y5dw.json";

const FIELDS = [
  "nys_health_operation_id",
  "facility",
  "operation_name",
  "facility_address",
  "city",
  "zip_code",
  "county",
  "description",
  "date",
  "total_critical_violations",
  "total_noncritical_violations",
  "total_crit_not_corrected",
  "violations",
  "inspection_comments",
  "location1",
];

const PAGE_SIZE = 10_000;
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3;

export interface SourceRow {
  facility?: string;
  operation_name?: string;
  facility_address?: string;
  city?: string;
  zip_code?: string;
  county?: string;
  description?: string;
  date?: string;
  total_critical_violations?: string;
  total_noncritical_violations?: string;
  total_crit_not_corrected?: string;
  violations?: string;
  inspection_comments?: string;
  location1?: { latitude?: string; longitude?: string };
  nys_health_operation_id?: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface SyncOptions {
  appToken?: string;
  fetch?: FetchLike;
  logger?: Logger;
  /** Re-download even if the source says it hasn't changed. */
  force?: boolean;
}

export interface SyncResult {
  status: "updated" | "unchanged";
  rows: number;
  skipped: number;
  /** Establishments that appeared in more than one source row and were merged into one. */
  merged: number;
  durationMs: number;
}

/**
 * The source has lost some non-ASCII characters to U+FFFD upstream. Restore the
 * ones we can infer with confidence (temperatures, "Café") and drop the rest,
 * which are mostly lost bullet points in inspector comments.
 */
export function repairText(s: string): string {
  return s
    .replace(/(\d)\s?�\s?([FC])\b/g, "$1°$2")
    .replace(/\b(caf)�/gi, (_, caf: string) => caf + (caf === caf.toUpperCase() ? "É" : "é"))
    .replace(/�/g, "");
}

const clean = (s: string | undefined): string | null => {
  const t = s && repairText(s).replace(/\s+/g, " ").trim();
  return t ? t : null;
};

const count = (s: string | undefined): number => {
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 ? n : 0;
};

/** Convert one API row into our shape, or return null if it can't be placed on the map. */
export function toEstablishment(r: SourceRow): NewEstablishment | null {
  const id = r.nys_health_operation_id?.trim();
  const name = clean(r.facility) ?? clean(r.operation_name);
  const lat = Number(r.location1?.latitude);
  const lng = Number(r.location1?.longitude);
  if (!id || !/^\d{1,12}$/.test(id) || !name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < NY_BOUNDS.south || lat > NY_BOUNDS.north || lng < NY_BOUNDS.west || lng > NY_BOUNDS.east) return null;

  const date = r.date && !Number.isNaN(Date.parse(r.date)) ? r.date.slice(0, 10) : null;

  return {
    id,
    name,
    address: clean(r.facility_address) ?? "",
    city: clean(r.city),
    zip: clean(r.zip_code),
    county: clean(r.county),
    description: clean(r.description)?.replace(/^Food Service Establishment - /, "") ?? null,
    inspection_date: date,
    critical_count: count(r.total_critical_violations),
    noncritical_count: count(r.total_noncritical_violations),
    crit_not_corrected: count(r.total_crit_not_corrected),
    comments: clean(r.inspection_comments),
    lat,
    lng,
    violations: parseViolations(r.violations && repairText(r.violations)),
  };
}

export interface MergeReport {
  id: string;
  rows: number;
  /** "identical": exact copies; "latest": kept the most recent inspection; "combined": same date, results merged. */
  resolution: "identical" | "latest" | "combined";
}

function union<T>(lists: T[][], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const list of lists) {
    for (const item of list) {
      const k = key(item);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(item);
      }
    }
  }
  return out;
}

/**
 * The dataset occasionally lists one establishment (one NYS Health operation id)
 * in more than one row. Collapse each group into a single establishment:
 * exact copies become one; otherwise the most recent inspection wins; and when
 * the rows describe the same inspection date differently, their results are
 * combined — the higher totals and every distinct violation and note — so
 * nothing the state published is hidden.
 */
export function mergeDuplicates(rows: NewEstablishment[]): { rows: NewEstablishment[]; merges: MergeReport[] } {
  const groups = new Map<string, NewEstablishment[]>();
  for (const r of rows) {
    const g = groups.get(r.id);
    if (g) g.push(r);
    else groups.set(r.id, [r]);
  }

  const out: NewEstablishment[] = [];
  const merges: MergeReport[] = [];
  for (const [id, group] of groups) {
    if (group.length === 1) {
      out.push(group[0]!);
      continue;
    }
    if (new Set(group.map((r) => JSON.stringify(r))).size === 1) {
      out.push(group[0]!);
      merges.push({ id, rows: group.length, resolution: "identical" });
      continue;
    }
    const latestDate = group.reduce<string | null>((max, r) => (r.inspection_date && (!max || r.inspection_date > max) ? r.inspection_date : max), null);
    const latest = group.filter((r) => r.inspection_date === latestDate);
    if (latest.length === 1) {
      out.push(latest[0]!);
      merges.push({ id, rows: group.length, resolution: "latest" });
      continue;
    }
    const comments = union(
      latest.map((r) => (r.comments ?? "").split("|").map((c) => c.trim()).filter(Boolean)),
      (c) => c,
    );
    out.push({
      ...latest[0]!,
      critical_count: Math.max(...latest.map((r) => r.critical_count)),
      noncritical_count: Math.max(...latest.map((r) => r.noncritical_count)),
      crit_not_corrected: Math.max(...latest.map((r) => r.crit_not_corrected)),
      comments: comments.length ? comments.join("|") : null,
      violations: union(
        latest.map((r) => r.violations),
        (v) => `${v.code}|${v.critical}|${v.description}`,
      ),
    });
    merges.push({ id, rows: group.length, resolution: "combined" });
  }
  return { rows: out, merges };
}

async function fetchWithRetry(url: string, init: RequestInit, doFetch: FetchLike, logger: Logger): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await doFetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (res.ok) return res;
      lastError = new Error(`Upstream responded ${res.status}`);
      if (res.status < 500 && res.status !== 429) break;
    } catch (err) {
      lastError = err;
    }
    if (attempt < MAX_ATTEMPTS) {
      const delay = 1000 * 2 ** (attempt - 1);
      logger.warn("upstream request failed; retrying", { attempt, delayMs: delay, err: lastError });
      await Bun.sleep(delay);
    }
  }
  throw new Error("Could not reach the NYS open data service", { cause: lastError });
}

let running: Promise<SyncResult> | null = null;

/** Run a sync; concurrent callers share the one already in flight. */
export function syncDataset(store: Store, opts: SyncOptions = {}): Promise<SyncResult> {
  running ??= runSync(store, opts).finally(() => {
    running = null;
  });
  return running;
}

async function runSync(store: Store, opts: SyncOptions): Promise<SyncResult> {
  const logger = (opts.logger ?? rootLog).child({ component: "sync" });
  const doFetch = opts.fetch ?? fetch;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.appToken) headers["X-App-Token"] = opts.appToken;
  const started = performance.now();

  // Cheap probe: has the source changed since our last copy?
  const probe = await fetchWithRetry(`${DATASET_URL}?$select=:id&$limit=1`, { headers }, doFetch, logger);
  const sourceModified = probe.headers.get("X-SODA2-Truth-Last-Modified") ?? probe.headers.get("Last-Modified") ?? "";
  await probe.body?.cancel();
  if (!opts.force && sourceModified && sourceModified === store.getMeta("source_last_modified") && store.count() > 0) {
    store.setMeta("last_checked_at", new Date().toISOString());
    logger.info("source unchanged; skipping download", { sourceModified });
    return { status: "unchanged", rows: store.count(), skipped: 0, merged: 0, durationMs: Math.round(performance.now() - started) };
  }

  logger.info("downloading dataset", { sourceModified });
  const rows: NewEstablishment[] = [];
  let skipped = 0;
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const params = new URLSearchParams({
      $select: FIELDS.join(","),
      $order: ":id", // Socrata's row id, used only to page in a stable order
      $limit: String(PAGE_SIZE),
      $offset: String(offset),
    });
    const res = await fetchWithRetry(`${DATASET_URL}?${params}`, { headers }, doFetch, logger);
    const page = (await res.json()) as unknown;
    if (!Array.isArray(page)) throw new Error("Unexpected response shape from the NYS open data service");
    for (const raw of page as SourceRow[]) {
      const est = toEstablishment(raw);
      if (est) rows.push(est);
      else skipped++;
    }
    logger.debug("page fetched", { offset, received: page.length });
    if (page.length < PAGE_SIZE) break;
  }

  if (rows.length === 0) throw new Error("The NYS open data service returned no usable rows; keeping existing data");

  const { rows: establishments, merges } = mergeDuplicates(rows);
  for (const m of merges) {
    // Conflicting copies of one establishment are worth reporting to the state; exact copies are just noise.
    if (m.resolution === "combined") logger.warn("source lists conflicting results for one establishment; combined them", { ...m });
    else logger.info("merged duplicate source rows", { ...m });
  }

  const now = new Date().toISOString();
  store.replaceAll(establishments, {
    source_last_modified: sourceModified,
    last_synced_at: now,
    last_checked_at: now,
    row_count: String(establishments.length),
  });
  const durationMs = Math.round(performance.now() - started);
  logger.info("dataset synced", { rows: establishments.length, skipped, merged: merges.length, durationMs });
  return { status: "updated", rows: establishments.length, skipped, merged: merges.length, durationMs };
}

/** Sync now if the local copy is empty or stale, then keep checking on an interval. */
export function scheduleSync(store: Store, intervalHours: number, opts: SyncOptions = {}): () => void {
  const logger = (opts.logger ?? rootLog).child({ component: "sync" });
  const intervalMs = intervalHours * 3_600_000;
  const attempt = () =>
    syncDataset(store, opts).catch((err) => logger.error("sync failed; continuing with existing data", { err }));

  const lastChecked = Date.parse(store.getMeta("last_checked_at") ?? "");
  if (store.count() === 0 || !Number.isFinite(lastChecked) || Date.now() - lastChecked > intervalMs) void attempt();
  else logger.info("local data is fresh", { lastChecked: new Date(lastChecked).toISOString() });

  const timer = setInterval(attempt, intervalMs);
  return () => clearInterval(timer);
}
