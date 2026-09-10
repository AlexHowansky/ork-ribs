import type { Server } from "bun";
import type { Store } from "./db.ts";
import { AppError, errorResponse, Errors } from "./errors.ts";
import { log as rootLog, type Logger } from "./log.ts";
import { RateLimiter, securityHeaders } from "./security.ts";
import type { StaticFiles } from "./static.ts";
import { contains, intersects, NY_BOUNDS, NYC_BOUNDS, parseBBox, parseEstablishmentId, parseZoom, type BBox } from "./validate.ts";

/** Above this many establishments in view, the server returns grid clusters instead of points. */
export const POINT_LIMIT = 800;
const CLIENT_LOG_MAX_BYTES = 8 * 1024;

export interface AppOptions {
  store: Store;
  staticFiles?: StaticFiles;
  production?: boolean;
  rateLimitPerMinute?: number;
  logger?: Logger;
}

export type Notice = "outside-ny" | "nyc" | "empty" | null;

function noticeFor(bbox: BBox, total: number): Notice {
  if (!intersects(bbox, NY_BOUNDS)) return "outside-ny";
  if (contains(NYC_BOUNDS, bbox) || (total === 0 && intersects(bbox, NYC_BOUNDS))) return "nyc";
  return total === 0 ? "empty" : null;
}

/** Degrees per cluster cell: about a quarter of a 256px tile at this zoom (~64px on screen). */
export function cellSizeFor(zoom: number): number {
  return 90 / 2 ** Math.floor(zoom);
}

function clientIp(req: Request, server: Server<unknown> | undefined): string {
  return server?.requestIP(req)?.address ?? "unknown";
}

export function createApp(opts: AppOptions) {
  const { store, staticFiles } = opts;
  const logger = (opts.logger ?? rootLog).child({ component: "http" });
  const baseHeaders = securityHeaders(opts.production ?? false);
  const limiter = new RateLimiter(60, opts.rateLimitPerMinute ?? 240);

  function json(body: unknown, extra: Record<string, string> = {}, status = 200): Response {
    return Response.json(body, { status, headers: { ...baseHeaders, ...extra } });
  }

  function establishments(url: URL): Response {
    if (store.count() === 0) throw Errors.unavailable();
    const bbox = parseBBox(url.searchParams.get("bbox"));
    const zoom = parseZoom(url.searchParams.get("zoom"));
    const total = store.countInBox(bbox);
    const cache = { "Cache-Control": "public, max-age=300" };
    if (total <= POINT_LIMIT) {
      return json({ mode: "points", total, notice: noticeFor(bbox, total), items: store.pointsInBox(bbox, POINT_LIMIT) }, cache);
    }
    const items = store.clustersInBox(bbox, cellSizeFor(zoom));
    return json({ mode: "clusters", total, notice: noticeFor(bbox, total), items }, cache);
  }

  function establishment(id: string): Response {
    const row = store.getEstablishment(parseEstablishmentId(id));
    if (!row) throw Errors.notFound("We couldn't find that establishment. It may have been removed from the state's records.");
    return json(
      {
        id: row.id,
        name: row.name,
        address: row.address,
        city: row.city,
        zip: row.zip,
        county: row.county,
        description: row.description,
        inspectionDate: row.inspection_date,
        critical: row.critical_count,
        noncritical: row.noncritical_count,
        criticalNotCorrected: row.crit_not_corrected,
        comments: row.comments
          ? row.comments
              .split("|")
              .map((s) => s.replace(/^[\s\-*•]+/, "").trim())
              .filter(Boolean)
          : [],
        violations: row.violations,
      },
      { "Cache-Control": "public, max-age=300" },
    );
  }

  function meta(): Response {
    return json(
      {
        establishments: store.count(),
        lastSyncedAt: store.getMeta("last_synced_at"),
        sourceLastModified: store.getMeta("source_last_modified"),
      },
      { "Cache-Control": "no-cache" },
    );
  }

  async function clientLog(req: Request, reqLog: Logger): Promise<Response> {
    const length = Number(req.headers.get("content-length") ?? "0");
    if (length > CLIENT_LOG_MAX_BYTES) throw Errors.tooLarge();
    if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) {
      throw Errors.badRequest("Log entries must be sent as JSON.");
    }
    const text = await req.text();
    if (text.length > CLIENT_LOG_MAX_BYTES) throw Errors.tooLarge();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw Errors.badRequest("Log entries must be sent as JSON.");
    }
    const entries = Array.isArray(body) ? body : [body];
    if (entries.length > 20) throw Errors.tooLarge();
    for (const e of entries) {
      if (typeof e !== "object" || e === null) continue;
      const { level, msg, ctx } = e as { level?: unknown; msg?: unknown; ctx?: unknown };
      if (typeof msg !== "string") continue;
      const lvl = level === "error" || level === "warn" ? level : "info";
      reqLog[lvl]("client log", {
        component: "client",
        clientMsg: msg.slice(0, 500),
        clientCtx: typeof ctx === "object" && ctx !== null ? JSON.stringify(ctx).slice(0, 2000) : undefined,
      });
    }
    return new Response(null, { status: 204, headers: baseHeaders });
  }

  async function route(req: Request, url: URL, reqLog: Logger, ip: string): Promise<Response> {
    const { pathname } = url;

    if (pathname === "/healthz") return json({ ok: true, establishments: store.count() }, { "Cache-Control": "no-store" });

    if (pathname.startsWith("/api/")) {
      if (!limiter.take(ip)) throw Errors.rateLimited();
      if (pathname === "/api/client-log") {
        if (req.method !== "POST") throw new AppError(405, "method_not_allowed", "That action isn't supported here.");
        return clientLog(req, reqLog);
      }
      if (req.method !== "GET") throw new AppError(405, "method_not_allowed", "That action isn't supported here.");
      if (pathname === "/api/establishments") return establishments(url);
      if (pathname === "/api/meta") return meta();
      const m = /^\/api\/establishments\/([^/]+)$/.exec(pathname);
      if (m) return establishment(decodeURIComponent(m[1]!));
      throw Errors.notFound();
    }

    if (req.method === "GET" || req.method === "HEAD") {
      const res = staticFiles?.serve(pathname, baseHeaders);
      if (res) return res;
    }
    return new Response("Not found", { status: 404, headers: { ...baseHeaders, "Content-Type": "text/plain; charset=utf-8" } });
  }

  return async function fetch(req: Request, server?: Server<unknown>): Promise<Response> {
    const started = performance.now();
    const reqId = crypto.randomUUID();
    const url = new URL(req.url);
    const ip = clientIp(req, server);
    const reqLog = logger.child({ reqId });
    let res: Response;
    try {
      res = await route(req, url, reqLog, ip);
    } catch (err) {
      res = errorResponse(err, reqLog, baseHeaders);
    }
    res.headers.set("X-Request-Id", reqId);
    const status = res.status;
    const fields = { method: req.method, path: url.pathname, status, durationMs: Math.round(performance.now() - started), ip };
    if (status >= 500) reqLog.error("request", fields);
    else if (status >= 400) reqLog.warn("request", fields);
    else if (url.pathname.startsWith("/api/")) reqLog.info("request", fields);
    else reqLog.debug("request", fields);
    return res;
  };
}
