import type { LogLevel } from "./log.ts";

function intFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`Environment variable ${name} must be an integer between ${min} and ${max}`);
  }
  return n;
}

function levelFromEnv(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") return raw;
  throw new Error("Environment variable LOG_LEVEL must be one of debug, info, warn, error");
}

export const config = {
  port: intFromEnv("PORT", 3000, 1, 65535),
  host: process.env.HOST ?? "127.0.0.1",
  dbPath: process.env.DB_PATH ?? "data/ork.sqlite",
  logLevel: levelFromEnv(),
  production: process.env.NODE_ENV === "production",
  socrataAppToken: process.env.SOCRATA_APP_TOKEN || undefined,
  syncIntervalHours: intFromEnv("SYNC_INTERVAL_HOURS", 24, 1, 24 * 30),
  /** Requests per minute per client IP on /api/*. */
  rateLimitPerMinute: intFromEnv("RATE_LIMIT_PER_MINUTE", 240, 10, 100_000),
} as const;
