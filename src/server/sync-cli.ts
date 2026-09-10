/** `bun run sync [--force]` — refresh the local copy of the dataset once and exit. */
import { config } from "./config.ts";
import { Store } from "./db.ts";
import { log } from "./log.ts";
import { syncDataset } from "./sync.ts";

const store = new Store(config.dbPath);
try {
  const result = await syncDataset(store, { appToken: config.socrataAppToken, force: process.argv.includes("--force") });
  log.info("sync complete", { ...result });
} catch (err) {
  log.error("sync failed", { err });
  process.exitCode = 1;
} finally {
  store.close();
}
