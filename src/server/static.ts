import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Serve only files that exist in the build output. The allowlist is made once
 * at startup, so request paths are looked up in a map and never joined onto the
 * filesystem path — there is no path traversal to get wrong.
 */
export class StaticFiles {
  private files = new Map<string, string>();

  constructor(private readonly root: string) {
    this.refresh();
  }

  refresh(): void {
    this.files.clear();
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else this.files.set("/" + relative(this.root, full).split(sep).join("/"), full);
      }
    };
    try {
      walk(this.root);
    } catch {
      // No build output yet; every lookup misses.
    }
  }

  get size(): number {
    return this.files.size;
  }

  /** Returns the response for `pathname`, or null if there is no such file. */
  serve(pathname: string, headers: Record<string, string>): Response | null {
    const key = pathname === "/" ? "/index.html" : pathname;
    const path = this.files.get(key);
    if (!path) return null;
    // Bundled assets carry a content hash in their name and never change; the
    // HTML shell and un-hashed vendor files must be revalidated.
    const hashed = /-[a-z0-9]{8,}\.(js|css|mjs|svg|png|woff2?)$/.test(key);
    return new Response(Bun.file(path), {
      headers: { ...headers, "Cache-Control": hashed ? "public, max-age=31536000, immutable" : "no-cache" },
    });
  }
}
