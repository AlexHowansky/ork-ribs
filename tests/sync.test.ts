import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Store } from "../src/server/db.ts";
import { setLogLevel } from "../src/server/log.ts";
import { repairText, syncDataset, toEstablishment, type SourceRow } from "../src/server/sync.ts";

setLogLevel("error");

const row = (over: Partial<SourceRow> = {}): SourceRow => ({
  ":id": "row-aaaa.bbbb_cccc",
  facility: "TEST DINER",
  facility_address: "1 MAIN STREET",
  city: "ALBANY",
  zip_code: "12207",
  county: "ALBANY",
  description: "Food Service Establishment - Restaurant",
  date: "2026-08-07T00:00:00.000",
  total_critical_violations: "1",
  total_noncritical_violations: "2",
  total_crit_not_corrected: "0",
  violations: "Item  5A-  Critical Violation [RED] Foods not kept at or below 45�F.; Item  8A-   Food not protected;",
  inspection_comments: "Cold holding adequate.|� Hot holding adequate.",
  location1: { latitude: "42.65", longitude: "-73.75" },
  nys_health_operation_id: "123",
  ...over,
});

describe("repairText", () => {
  test("restores degree signs and Café, drops the rest", () => {
    expect(repairText("kept at 45�F or 7 � C")).toBe("kept at 45°F or 7°C");
    expect(repairText("CROSSROADS CAF�")).toBe("CROSSROADS CAFÉ");
    expect(repairText("China Caf�")).toBe("China Café");
    expect(repairText("� Gloves in use")).toBe(" Gloves in use");
  });
});

describe("toEstablishment", () => {
  test("maps a source row", () => {
    const e = toEstablishment(row())!;
    expect(e).toMatchObject({
      id: "row-aaaa.bbbb_cccc",
      name: "TEST DINER",
      description: "Restaurant",
      inspection_date: "2026-08-07",
      critical_count: 1,
      noncritical_count: 2,
      lat: 42.65,
      lng: -73.75,
      comments: "Cold holding adequate.| Hot holding adequate.",
    });
    expect(e.violations).toEqual([
      { code: "5A", critical: true, description: "Foods not kept at or below 45°F." },
      { code: "8A", critical: false, description: "Food not protected" },
    ]);
  });

  test("skips rows that can't be placed on the map", () => {
    expect(toEstablishment(row({ location1: undefined }))).toBeNull();
    expect(toEstablishment(row({ location1: { latitude: "0", longitude: "0" } }))).toBeNull();
    expect(toEstablishment(row({ ":id": undefined }))).toBeNull();
    expect(toEstablishment(row({ facility: " ", operation_name: undefined }))).toBeNull();
  });

  test("tolerates bad counts and dates", () => {
    const e = toEstablishment(row({ total_critical_violations: "x", date: "not a date" }))!;
    expect(e.critical_count).toBe(0);
    expect(e.inspection_date).toBeNull();
  });
});

describe("syncDataset", () => {
  let store: Store;
  beforeEach(() => {
    store = new Store(":memory:");
  });
  afterEach(() => store.close());

  function fakeFetch(pages: SourceRow[][], lastModified = "Tue, 08 Sep 2026 18:07:32 GMT") {
    const calls: string[] = [];
    const fn = async (url: string) => {
      calls.push(url);
      const headers = { "Content-Type": "application/json", "X-SODA2-Truth-Last-Modified": lastModified };
      if (url.includes("$limit=1") && !url.includes("$offset")) return new Response("[]", { headers });
      const offset = Number(new URL(url).searchParams.get("$offset"));
      return new Response(JSON.stringify(pages[offset / 10_000] ?? []), { headers });
    };
    return { fn, calls };
  }

  test("loads rows, then skips when the source is unchanged", async () => {
    const { fn, calls } = fakeFetch([[row(), row({ ":id": "row-2", location1: undefined })]]);
    const first = await syncDataset(store, { fetch: fn });
    expect(first).toMatchObject({ status: "updated", rows: 1, skipped: 1 });
    expect(store.getEstablishment("row-aaaa.bbbb_cccc")!.violations).toHaveLength(2);

    const second = await syncDataset(store, { fetch: fn });
    expect(second.status).toBe("unchanged");
    expect(calls.filter((c) => new URL(c).searchParams.has("$offset"))).toHaveLength(1);
  });

  test("keeps existing data when the upstream fails", async () => {
    await syncDataset(store, { fetch: fakeFetch([[row()]]).fn });
    const failing = async () => new Response("nope", { status: 400 });
    await expect(syncDataset(store, { fetch: failing, force: true })).rejects.toThrow();
    expect(store.count()).toBe(1);
  });

  test("refuses to replace data with an empty download", async () => {
    await syncDataset(store, { fetch: fakeFetch([[row()]]).fn });
    await expect(syncDataset(store, { fetch: fakeFetch([[]], "later").fn })).rejects.toThrow(/no usable rows/);
    expect(store.count()).toBe(1);
  });
});
