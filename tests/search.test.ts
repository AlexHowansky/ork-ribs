import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/server/app.ts";
import { Store, type NewEstablishment } from "../src/server/db.ts";
import { setLogLevel } from "../src/server/log.ts";
import { foldForSearch, haversineKm } from "../src/server/search.ts";

setLogLevel("error");

const ALBANY = { lat: 42.6526, lng: -73.7562 };

let n = 0;
function est(name: string, lat: number, lng: number): NewEstablishment {
  n++;
  return {
    id: String(5000 + n),
    name,
    address: `${n} MAIN STREET`,
    city: "SOMEWHERE",
    zip: null,
    county: null,
    description: null,
    inspection_date: "2026-08-07",
    critical_count: 0,
    noncritical_count: 0,
    crit_not_corrected: 0,
    comments: null,
    lat,
    lng,
    violations: [],
  };
}

let store: Store;
let app: ReturnType<typeof createApp>;
const get = async (path: string) => {
  const res = await app(new Request(`http://localhost${path}`));
  return { status: res.status, body: (await res.json()) as any };
};

beforeAll(() => {
  store = new Store(":memory:");
  store.replaceAll(
    [
      est("NOHO PIZZA", 42.66, -73.77), // ~1 km from Albany centre
      est("Pizza Palace", 42.1, -76.0), // Binghamton area, far
      est("SLICE OF PIZZA", 42.9, -73.7), // Saratoga direction, middle
      est("TUSCAN CAFÉ", 42.65, -73.75),
      est("China Café", 43.05, -76.15),
      est("JIMMY D'S CAFE", 42.651, -73.757),
      est("BURGER BARN", 42.65, -73.76),
    ],
    { source_last_modified: "x", last_synced_at: "2026-09-10T00:00:00Z" },
  );
  app = createApp({ store, rateLimitPerMinute: 100_000 });
});
afterAll(() => store.close());

describe("foldForSearch", () => {
  test("lower-cases, strips accents and tidies spaces", () => {
    expect(foldForSearch("  TUSCAN   CAFÉ ")).toBe("tuscan cafe");
    expect(foldForSearch("Crème Brûlée")).toBe("creme brulee");
  });
});

test("haversineKm is about right", () => {
  // Albany to Syracuse is roughly 200 km as the crow flies.
  expect(haversineKm(42.6526, -73.7562, 43.0481, -76.1474)).toBeGreaterThan(190);
  expect(haversineKm(42.6526, -73.7562, 43.0481, -76.1474)).toBeLessThan(210);
  expect(haversineKm(1, 2, 1, 2)).toBe(0);
});

describe("Store.search", () => {
  test("matches a case-insensitive substring anywhere in the name", () => {
    const names = store.search("pIzZ").map((r) => r.name);
    expect(names.sort()).toEqual(["NOHO PIZZA", "Pizza Palace", "SLICE OF PIZZA"]);
  });

  test("accents don't matter in either direction", () => {
    expect(store.search("cafe").map((r) => r.name).sort()).toEqual(["China Café", "JIMMY D'S CAFE", "TUSCAN CAFÉ"]);
    expect(store.search("CAFÉ").map((r) => r.name).sort()).toEqual(["China Café", "JIMMY D'S CAFE", "TUSCAN CAFÉ"]);
  });

  test("returns every match, nearest first, with distances", () => {
    const r = store.search("pizza", ALBANY);
    expect(r.map((x) => x.name)).toEqual(["NOHO PIZZA", "SLICE OF PIZZA", "Pizza Palace"]);
    expect(r.every((x, i) => i === 0 || r[i - 1]!.distanceKm! <= x.distanceKm!)).toBe(true);
    expect(r[0]!.distanceKm!).toBeLessThan(2);
  });

  test("without a reference point, results are alphabetical", () => {
    expect(store.search("pizza").map((r) => r.name)).toEqual(["NOHO PIZZA", "Pizza Palace", "SLICE OF PIZZA"]);
    expect(store.search("pizza").every((r) => r.distanceKm === null)).toBe(true);
  });

  test("characters that are wildcards elsewhere are matched literally", () => {
    expect(store.search("%")).toEqual([]);
    expect(store.search("_")).toEqual([]);
    expect(store.search("d'")).toHaveLength(1);
  });
});

describe("GET /api/search", () => {
  test("returns matches sorted by distance from the given point", async () => {
    const { status, body } = await get(`/api/search?q=pizza&lat=${ALBANY.lat}&lng=${ALBANY.lng}`);
    expect(status).toBe(200);
    expect(body).toMatchObject({ query: "pizza", total: 3, sortedBy: "distance" });
    expect(body.items[0].name).toBe("NOHO PIZZA");
  });

  test("sorts by name when no point is given", async () => {
    const { body } = await get("/api/search?q=cafe");
    expect(body.sortedBy).toBe("name");
    expect(body.total).toBe(3);
  });

  test("no matches is an empty list, not an error", async () => {
    const { status, body } = await get("/api/search?q=xyzzy");
    expect(status).toBe(200);
    expect(body).toMatchObject({ total: 0, items: [] });
  });

  test.each([
    ["/api/search", /at least 2/],
    ["/api/search?q=%20a%20", /at least 2/],
    [`/api/search?q=${"a".repeat(101)}`, /at most 100/],
    ["/api/search?q=pizza&lat=42", /sort results/],
    ["/api/search?q=pizza&lat=abc&lng=1", /sort results/],
    ["/api/search?q=pizza&lat=91&lng=1", /sort results/],
  ])("rejects %s with a friendly message", async (path, message) => {
    const { status, body } = await get(path);
    expect(status).toBe(400);
    expect(body.error.message).toMatch(message);
  });
});
