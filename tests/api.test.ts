import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createApp, POINT_LIMIT } from "../src/server/app.ts";
import { Store, type NewEstablishment } from "../src/server/db.ts";
import { setLogLevel } from "../src/server/log.ts";

setLogLevel("error");

function est(i: number, over: Partial<NewEstablishment> = {}): NewEstablishment {
  return {
    id: String(1000 + i),
    name: `PLACE ${i}`,
    address: `${i} MAIN STREET`,
    city: "ALBANY",
    zip: "12207",
    county: "ALBANY",
    description: "Restaurant",
    inspection_date: "2026-08-07",
    critical_count: i % 3 === 0 ? 1 : 0,
    noncritical_count: i % 2,
    crit_not_corrected: 0,
    comments: "- Cold holding adequate.|Dishwasher OK",
    // Spread over roughly Albany.
    lat: 42.6 + (i % 50) * 0.002,
    lng: -73.8 + Math.floor(i / 50) * 0.002,
    violations: i % 3 === 0 ? [{ code: "5A", critical: true, description: "Too warm" }] : [],
    ...over,
  };
}

let store: Store;
let app: ReturnType<typeof createApp>;
const get = (path: string, init?: RequestInit) => app(new Request(`http://localhost${path}`, init));

beforeAll(() => {
  store = new Store(":memory:");
  const rows = Array.from({ length: POINT_LIMIT + 200 }, (_, i) => est(i));
  store.replaceAll(rows, { source_last_modified: "Tue, 08 Sep 2026 18:07:32 GMT", last_synced_at: "2026-09-10T00:00:00Z" });
  app = createApp({ store, rateLimitPerMinute: 100_000 });
});
afterAll(() => store.close());

describe("GET /api/establishments", () => {
  test("returns points for a small area", async () => {
    const res = await get("/api/establishments?bbox=-73.801,42.599,-73.797,42.61&zoom=16");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mode: string; total: number; items: { id: string }[]; notice: unknown };
    expect(body.mode).toBe("points");
    expect(body.total).toBe(body.items.length);
    expect(body.total).toBeGreaterThan(0);
    expect(body.notice).toBeNull();
  });

  test("returns clusters when too many are in view", async () => {
    const res = await get("/api/establishments?bbox=-74,42,-73,43&zoom=10");
    const body = (await res.json()) as { mode: string; total: number; items: { count: number }[] };
    expect(body.mode).toBe("clusters");
    expect(body.total).toBe(POINT_LIMIT + 200);
    expect(body.items.reduce((n, c) => n + c.count, 0)).toBe(body.total);
  });

  test("explains empty NYC and out-of-state views", async () => {
    const nyc = (await (await get("/api/establishments?bbox=-74.01,40.70,-73.95,40.75&zoom=14")).json()) as { notice: string };
    expect(nyc.notice).toBe("nyc");
    const away = (await (await get("/api/establishments?bbox=2.2,48.8,2.4,48.9&zoom=12")).json()) as { notice: string };
    expect(away.notice).toBe("outside-ny");
  });

  test("rejects a malformed area with a friendly message", async () => {
    const res = await get("/api/establishments?bbox=1,2,x,4&zoom=3");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("bad_request");
    expect(body.error.message).toMatch(/map area/);
  });
});

describe("GET /api/establishments/:id", () => {
  test("returns details with violations and tidy notes", async () => {
    const res = await get("/api/establishments/1003");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      id: "1003",
      name: "PLACE 3",
      inspectionDate: "2026-08-07",
      critical: 1,
      violations: [{ code: "5A", critical: true, description: "Too warm" }],
      comments: ["Cold holding adequate.", "Dishwasher OK"],
    });
  });

  test("unknown and malicious ids get a friendly 404", async () => {
    for (const id of ["999999", "row-3", "..%2F..%2Fetc%2Fpasswd", "x'%20OR%201=1--"]) {
      const res = await get(`/api/establishments/${id}`);
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { message: string } };
      expect(body.error.message).toMatch(/couldn't find/);
    }
  });
});

describe("cross-cutting behaviour", () => {
  test("every response carries security headers and a request id", async () => {
    for (const path of ["/api/meta", "/api/establishments?bbox=bad&zoom=1", "/nope"]) {
      const res = await get(path);
      expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
      expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
      expect(res.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  test("wrong methods are refused", async () => {
    const res = await get("/api/establishments?bbox=1,2,3,4&zoom=1", { method: "DELETE" });
    expect(res.status).toBe(405);
  });

  test("client log accepts small JSON only", async () => {
    const ok = await get("/api/client-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ level: "error", msg: "boom", ctx: { a: 1 } }]),
    });
    expect(ok.status).toBe(204);
    const big = await get("/api/client-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msg: "x".repeat(10_000) }),
    });
    expect(big.status).toBe(413);
    const notJson = await get("/api/client-log", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "hi" });
    expect(notJson.status).toBe(400);
  });

  test("rate limiting answers 429 with a friendly message", async () => {
    const limited = createApp({ store, rateLimitPerMinute: 10 });
    let last: Response | undefined;
    for (let i = 0; i < 70; i++) last = await limited(new Request("http://localhost/api/meta"));
    expect(last!.status).toBe(429);
    expect(((await last!.json()) as { error: { message: string } }).error.message).toMatch(/wait a moment/);
  });

  test("an empty database gives a friendly 503", async () => {
    const empty = new Store(":memory:");
    const res = await createApp({ store: empty })(new Request("http://localhost/api/establishments?bbox=-74,42,-73,43&zoom=10"));
    expect(res.status).toBe(503);
    empty.close();
  });
});
