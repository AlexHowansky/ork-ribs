/**
 * Inspection history for one establishment, read on demand from the NYS
 * "Food Service Establishment Inspections: Beginning 2005" dataset.
 * https://health.data.ny.gov/Health/Food-Service-Establishment-Inspections-Beginning-2/2hcc-shji
 */
import { AppError } from "./errors.ts";
import { log as rootLog, type Logger } from "./log.ts";
import type { FetchLike } from "./sync.ts";

/** Fixed upstream endpoint; only a validated numeric id is ever added to the query (no SSRF surface). */
export const HISTORY_URL = "https://health.data.ny.gov/resource/2hcc-shji.json";

const REQUEST_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 60 * 60_000;
const CACHE_MAX_ENTRIES = 1_000;
/** Far more inspections than any establishment has had since 2005; bounds the response. */
const MAX_INSPECTIONS = 1_000;

export interface Inspection {
  /** YYYY-MM-DD */
  date: string;
  critical: number;
  noncritical: number;
}

export interface HistoryOptions {
  appToken?: string;
  fetch?: FetchLike;
  logger?: Logger;
  now?: () => number;
}

const unavailable = () =>
  new AppError(503, "history_unavailable", "The inspection history isn't available right now. Please try again later.");

const count = (v: unknown): number => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : 0;
};

/**
 * Turn the upstream rows (one per inspection date) into a sorted history.
 * The dataset lists each violation as its own row, repeating the inspection's
 * totals on every one, so the query groups by date and keeps the highest totals —
 * the same rule the sync uses when one inspection appears more than once.
 */
export function toHistory(rows: unknown): Inspection[] {
  if (!Array.isArray(rows)) throw new Error("Unexpected response shape from the NYS open data service");
  const out: Inspection[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    const date = typeof r.date_of_inspection === "string" ? r.date_of_inspection.slice(0, 10) : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) continue;
    out.push({ date, critical: count(r.critical), noncritical: count(r.noncritical) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Fetches histories with a small in-memory cache, sharing any request already in flight for the same id. */
export function createHistorySource(opts: HistoryOptions = {}) {
  const logger = (opts.logger ?? rootLog).child({ component: "history" });
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.appToken) headers["X-App-Token"] = opts.appToken;

  const cache = new Map<string, { at: number; items: Inspection[] }>();
  const inflight = new Map<string, Promise<Inspection[]>>();

  async function load(id: string): Promise<Inspection[]> {
    const params = new URLSearchParams({
      $select: "date_of_inspection, max(total_critical_violations) as critical, max(total_noncritical_violations) as noncritical",
      $where: `nys_health_operation_id = '${id}'`,
      $group: "date_of_inspection",
      $order: "date_of_inspection",
      $limit: String(MAX_INSPECTIONS),
    });
    const started = performance.now();
    let res: Response;
    try {
      res = await doFetch(`${HISTORY_URL}?${params}`, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
      logger.warn("history request failed", { id, err });
      throw unavailable();
    }
    if (!res.ok) {
      await res.body?.cancel();
      logger.warn("history request failed", { id, status: res.status });
      throw unavailable();
    }
    let items: Inspection[];
    try {
      items = toHistory(await res.json());
    } catch (err) {
      logger.warn("history response unreadable", { id, err });
      throw unavailable();
    }
    logger.debug("history fetched", { id, inspections: items.length, durationMs: Math.round(performance.now() - started) });
    return items;
  }

  return async function history(id: string): Promise<Inspection[]> {
    const t = now();
    const hit = cache.get(id);
    if (hit && t - hit.at < CACHE_TTL_MS) return hit.items;

    let pending = inflight.get(id);
    if (!pending) {
      pending = load(id).finally(() => inflight.delete(id));
      inflight.set(id, pending);
    }
    const items = await pending;
    cache.delete(id); // re-insert so the Map's order stays oldest-first for eviction
    cache.set(id, { at: t, items });
    if (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value!);
    return items;
  };
}

export type HistorySource = ReturnType<typeof createHistorySource>;
