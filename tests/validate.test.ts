import { describe, expect, test } from "bun:test";
import { AppError } from "../src/server/errors.ts";
import { contains, intersects, NY_BOUNDS, NYC_BOUNDS, parseBBox, parseEstablishmentId, parseZoom } from "../src/server/validate.ts";

const rejects = (fn: () => unknown, status: number) => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).status).toBe(status);
    return;
  }
  throw new Error("expected a rejection");
};

describe("parseBBox", () => {
  test("accepts a normal box", () => {
    expect(parseBBox("-73.8,42.6,-73.7,42.7")).toEqual({ west: -73.8, south: 42.6, east: -73.7, north: 42.7 });
  });

  test.each([
    null,
    "",
    "1,2,3",
    "1,2,3,4,5",
    "a,b,c,d",
    "-73.8,42.6,-73.9,42.7", // west > east
    "-73.8,42.7,-73.7,42.6", // south > north
    "-181,0,0,1",
    "0,-91,1,0",
    "1e3,0,2,1",
    "0x10,0,20,1",
    "-73.8,42.6,-73.7,42.7;DROP TABLE establishments",
    "1".repeat(200),
  ])("rejects %p", (raw) => rejects(() => parseBBox(raw), 400));
});

describe("parseZoom", () => {
  test("accepts 0..24", () => {
    expect(parseZoom("0")).toBe(0);
    expect(parseZoom("14.25")).toBe(14.25);
    expect(parseZoom("24")).toBe(24);
  });
  test.each([null, "", "-1", "25", "abc", "1e1"])("rejects %p", (raw) => rejects(() => parseZoom(raw), 400));
});

describe("parseEstablishmentId", () => {
  test("accepts NYS Health operation ids", () => {
    expect(parseEstablishmentId("252181")).toBe("252181");
  });
  test.each([undefined, "", "row-9a2c_hizz~i8kj", "../etc/passwd", "1 2", "1'--", "-5", "1".repeat(13)])("rejects %p as not found", (raw) =>
    rejects(() => parseEstablishmentId(raw), 404),
  );
});

test("box helpers", () => {
  expect(intersects(NYC_BOUNDS, NY_BOUNDS)).toBe(true);
  expect(contains(NY_BOUNDS, NYC_BOUNDS)).toBe(true);
  expect(intersects({ west: 0, south: 0, east: 1, north: 1 }, NY_BOUNDS)).toBe(false);
});
