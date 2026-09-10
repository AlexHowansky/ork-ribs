/**
 * Structured JSON-lines logger. Every line carries `ts`, `level` and `msg`;
 * callers add context (request id, durations, counts) as extra fields.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold: LogLevel = (() => {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  return raw in ORDER ? (raw as LogLevel) : "info";
})();

export function setLogLevel(level: LogLevel): void {
  threshold = level;
}

export type LogContext = Record<string, unknown>;

function serializeError(err: unknown): unknown {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack, cause: err.cause ? serializeError(err.cause) : undefined };
  }
  return err;
}

function write(level: LogLevel, msg: string, ctx?: LogContext): void {
  if (ORDER[level] < ORDER[threshold]) return;
  const entry: LogContext = { ts: new Date().toISOString(), level, msg };
  if (ctx) {
    for (const [k, v] of Object.entries(ctx)) entry[k] = k === "err" ? serializeError(v) : v;
  }
  const line = JSON.stringify(entry);
  if (level === "error" || level === "warn") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

export interface Logger {
  debug(msg: string, ctx?: LogContext): void;
  info(msg: string, ctx?: LogContext): void;
  warn(msg: string, ctx?: LogContext): void;
  error(msg: string, ctx?: LogContext): void;
  child(bound: LogContext): Logger;
}

function make(bound: LogContext): Logger {
  const merge = (ctx?: LogContext) => (ctx ? { ...bound, ...ctx } : bound);
  return {
    debug: (m, c) => write("debug", m, merge(c)),
    info: (m, c) => write("info", m, merge(c)),
    warn: (m, c) => write("warn", m, merge(c)),
    error: (m, c) => write("error", m, merge(c)),
    child: (more) => make({ ...bound, ...more }),
  };
}

export const log: Logger = make({});
