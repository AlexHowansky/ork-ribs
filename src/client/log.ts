/**
 * Client logger: mirrors the server's structured shape in the console and
 * forwards warnings and errors to the server log so they can be debugged there.
 */
type Level = "debug" | "info" | "warn" | "error";
type Ctx = Record<string, unknown>;

const MAX_REPORTS = 25;
let reported = 0;
let queue: { level: Level; msg: string; ctx?: Ctx }[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

function flush(): void {
  timer = undefined;
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  fetch("/api/client-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(batch),
    keepalive: true,
  }).catch(() => {
    /* never let logging failures cascade */
  });
}

function report(level: Level, msg: string, ctx?: Ctx): void {
  if (reported >= MAX_REPORTS) return;
  reported++;
  queue.push({ level, msg, ctx: { ...ctx, page: location.pathname } });
  timer ??= setTimeout(flush, 1000);
}

function toPlain(ctx?: Ctx): Ctx | undefined {
  if (!ctx) return undefined;
  const out: Ctx = {};
  for (const [k, v] of Object.entries(ctx)) out[k] = v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v;
  return out;
}

function write(level: Level, msg: string, ctx?: Ctx): void {
  const plain = toPlain(ctx);
  const line = { ts: new Date().toISOString(), level, msg, ...plain };
  const method = level === "debug" ? "debug" : level === "info" ? "info" : level;
  console[method]("[ork]", line);
  if (level === "warn" || level === "error") report(level, msg, plain);
}

export const log = {
  debug: (msg: string, ctx?: Ctx) => write("debug", msg, ctx),
  info: (msg: string, ctx?: Ctx) => write("info", msg, ctx),
  warn: (msg: string, ctx?: Ctx) => write("warn", msg, ctx),
  error: (msg: string, ctx?: Ctx) => write("error", msg, ctx),
};

export function installGlobalErrorLogging(): void {
  window.addEventListener("error", (e) => log.error("uncaught error", { message: e.message, source: e.filename, line: e.lineno }));
  window.addEventListener("unhandledrejection", (e) => log.error("unhandled rejection", { reason: String(e.reason) }));
  window.addEventListener("pagehide", flush);
}
