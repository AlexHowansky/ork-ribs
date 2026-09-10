import { watch } from "node:fs";
import { join } from "node:path";
import { createApp } from "./app.ts";
import { buildClient, DIST } from "./build.ts";
import { config } from "./config.ts";
import { Store } from "./db.ts";
import { log, setLogLevel } from "./log.ts";
import { StaticFiles } from "./static.ts";
import { scheduleSync } from "./sync.ts";

setLogLevel(config.logLevel);

// In development, rebuild the client on every start (`bun --watch` restarts on edits).
// In production, serve what `bun run build` produced, building only if it is missing.
const staticFiles = new StaticFiles(DIST);
if (!config.production || staticFiles.size === 0) {
  await buildClient({ production: config.production });
  staticFiles.refresh();
}
if (!config.production) {
  // `bun --watch` only follows the server's imports; rebuild the client when its files change.
  let pending: ReturnType<typeof setTimeout> | undefined;
  watch(join(import.meta.dir, "..", "client"), { recursive: true }, () => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      buildClient({ production: false })
        .then(() => staticFiles.refresh())
        .catch((err) => log.error("client rebuild failed", { err }));
    }, 150);
  });
}

const store = new Store(config.dbPath);
const stopSync = scheduleSync(store, config.syncIntervalHours, { appToken: config.socrataAppToken });

const server = Bun.serve({
  port: config.port,
  hostname: config.host,
  maxRequestBodySize: 64 * 1024,
  fetch: createApp({ store, staticFiles, production: config.production, rateLimitPerMinute: config.rateLimitPerMinute }),
  error(err) {
    log.error("server error", { err });
    return Response.json(
      { error: { code: "internal", message: "Something went wrong on our end. Please try again in a moment." } },
      { status: 500 },
    );
  },
});

log.info("server listening", { url: server.url.href, production: config.production, establishments: store.count() });

function shutdown(signal: string) {
  log.info("shutting down", { signal });
  stopSync();
  void server.stop().then(() => {
    store.close();
    process.exit(0);
  });
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
