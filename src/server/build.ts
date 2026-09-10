/**
 * Bundle the client (HTML + TS + Tailwind/daisyUI CSS) into `dist/`.
 * Run directly with `bun run build`, or imported by the server at startup.
 */
import tailwind from "bun-plugin-tailwind";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "./log.ts";

const ROOT = join(import.meta.dir, "..", "..");
export const DIST = join(ROOT, "dist");

export async function buildClient({ production }: { production: boolean }): Promise<void> {
  const started = performance.now();
  rmSync(DIST, { recursive: true, force: true });
  const result = await Bun.build({
    entrypoints: [join(ROOT, "src/client/index.html")],
    outdir: DIST,
    target: "browser",
    minify: production,
    sourcemap: production ? "none" : "linked",
    plugins: [tailwind],
    define: { "process.env.NODE_ENV": JSON.stringify(production ? "production" : "development") },
  });
  if (!result.success) {
    for (const message of result.logs) log.error("build error", { message: String(message) });
    throw new Error("Client build failed");
  }

  for (const message of result.logs) log.debug("build message", { message: String(message) });

  // The theme script must run before first paint, so it stays a classic,
  // render-blocking script rather than being folded into the deferred module bundle.
  cpSync(join(ROOT, "src/client/theme-init.js"), join(DIST, "theme-init.js"));
  const htmlPath = join(DIST, "index.html");
  const html = readFileSync(htmlPath, "utf8");
  if (!html.includes("<title>")) throw new Error("Client build produced unexpected HTML");
  writeFileSync(htmlPath, html.replace("<title>", '<script src="/theme-init.js"></script>\n    <title>'));

  // MapLibre's web worker is loaded from our own origin so the CSP needs no blob: workers.
  const vendor = join(DIST, "vendor", "maplibre");
  mkdirSync(vendor, { recursive: true });
  for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
    cpSync(join(ROOT, "node_modules/maplibre-gl/dist", f), join(vendor, f));
  }
  log.info("client built", { outputs: result.outputs.length, durationMs: Math.round(performance.now() - started) });
}

if (import.meta.main) {
  await buildClient({ production: process.env.NODE_ENV === "production" || process.argv.includes("--production") });
}
