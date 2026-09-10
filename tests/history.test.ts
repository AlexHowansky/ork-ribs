import { afterAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/server/app.ts";
import { Store } from "../src/server/db.ts";
import { createHistorySource, HISTORY_URL, toHistory } from "../src/server/history.ts";
import { setLogLevel } from "../src/server/log.ts";

setLogLevel("error");

const upstreamRows = [
  { date_of_inspection: "2021-08-31T00:00:00.000", critical: "3", noncritical: "10" },
  { date_of_inspection: "2016-08-10T00:00:00.000", critical: "0", noncritical: "2" },
  { date_of_inspection: "not a date", critical: "1", noncritical: "1" },
  { date_of_inspection: "2019-08-13T00:00:00.000", critical: "-4", noncritical: "x" },
];

function fakeFetch(body: unknown, status = 200) {
  const calls: string[] = [];
  const fn = async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify(body), { status });
  };
  return { fn, calls };
}

describe("toHistory", () => {
  test("sorts by date, drops undated rows and treats bad counts as zero", () => {
    expect(toHistory(upstreamRows)).toEqual([
      { date: "2016-08-10", critical: 0, noncritical: 2 },
      { date: "2019-08-13", critical: 0, noncritical: 0 },
      { date: "2021-08-31", critical: 3, noncritical: 10 },
    ]);
  });

  test("rejects a response that isn't a list", () => {
    expect(() => toHistory({ message: "error" })).toThrow();
  });
});

describe("createHistorySource", () => {
  test("queries the fixed dataset for one operation id, grouped by inspection date", async () => {
    const { fn, calls } = fakeFetch(upstreamRows);
    const items = await createHistorySource({ fetch: fn })("921197");
    expect(items).toHaveLength(3);
    const url = new URL(calls[0]!);
    expect(`${url.origin}${url.pathname}`).toBe(HISTORY_URL);
    expect(url.searchParams.get("$where")).toBe("nys_health_operation_id = '921197'");
    expect(url.searchParams.get("$group")).toBe("date_of_inspection");
  });

  test("caches, and shares a request already in flight", async () => {
    const { fn, calls } = fakeFetch(upstreamRows);
    let t = 0;
    const history = createHistorySource({ fetch: fn, now: () => t });
    await Promise.all([history("1"), history("1")]);
    await history("1");
    expect(calls).toHaveLength(1);
    t += 2 * 60 * 60_000; // past the cache lifetime
    await history("1");
    expect(calls).toHaveLength(2);
  });

  test("upstream failures become a friendly 503 and aren't cached", async () => {
    const { fn, calls } = fakeFetch({ message: "boom" }, 500);
    const history = createHistorySource({ fetch: fn });
    await expect(history("1")).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/isn't available right now/) });
    const offline = createHistorySource({ fetch: () => Promise.reject(new TypeError("fetch failed")) });
    await expect(offline("1")).rejects.toMatchObject({ status: 503 });
    await expect(history("1")).rejects.toMatchObject({ status: 503 });
    expect(calls).toHaveLength(2);
  });
});

describe("GET /api/establishments/:id/history", () => {
  const store = new Store(":memory:");
  store.replaceAll(
    [
      {
        id: "921197",
        name: "1000 ACRES RANCH",
        address: "465 WARRENSBURG ROAD",
        city: "STONY CREEK",
        zip: "12878",
        county: "WARREN",
        description: "Restaurant",
        inspection_date: "2021-08-31",
        critical_count: 3,
        noncritical_count: 10,
        crit_not_corrected: 0,
        comments: null,
        lat: 43.42,
        lng: -73.87,
        violations: [],
      },
    ],
    { last_synced_at: "2026-09-10T00:00:00Z" },
  );
  afterAll(() => store.close());

  test("returns the establishment's inspections", async () => {
    const { fn } = fakeFetch(upstreamRows);
    const app = createApp({ store, history: createHistorySource({ fetch: fn }), rateLimitPerMinute: 100_000 });
    const res = await app(new Request("http://localhost/api/establishments/921197/history"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; inspections: unknown[] };
    expect(body.id).toBe("921197");
    expect(body.inspections).toHaveLength(3);
  });

  test("never asks upstream about unknown or malformed ids", async () => {
    const { fn, calls } = fakeFetch(upstreamRows);
    const app = createApp({ store, history: createHistorySource({ fetch: fn }), rateLimitPerMinute: 100_000 });
    for (const id of ["999999", "x'%20OR%201=1--", "..%2Fetc"]) {
      const res = await app(new Request(`http://localhost/api/establishments/${id}/history`));
      expect(res.status).toBe(404);
    }
    expect(calls).toHaveLength(0);
  });

  test("an upstream outage is reported without internals", async () => {
    const { fn } = fakeFetch({ message: "internal stack trace" }, 502);
    const app = createApp({ store, history: createHistorySource({ fetch: fn }), rateLimitPerMinute: 100_000 });
    const res = await app(new Request("http://localhost/api/establishments/921197/history"));
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).toContain("isn't available right now");
    expect(text).not.toContain("stack trace");
  });
});
