import { describe, expect, test } from "bun:test";
import { parseViolations } from "../src/server/violations.ts";

describe("parseViolations", () => {
  test("no violations", () => {
    expect(parseViolations("No violations found.")).toEqual([]);
    expect(parseViolations("")).toEqual([]);
    expect(parseViolations(null)).toEqual([]);
  });

  test("mixed critical and non-critical entries (real sample)", () => {
    const raw =
      "Item  5B-  Critical Violation [RED] Potentially hazardous foods are not cooled by an approved method where the food temperature can be reduced from 120oF to 70oF or less within two hours and 70oF to 45oF within four hours.; Item  5C-  Critical Violation [RED] Potentially hazardous foods are not stored under refrigeration except during necessary preparation or approved precooling procedures (room temperature storage).; Item  8A-   Food not protected during storage, preparation, display, transportation and service, from potential sources of contamination (e.g., food uncovered, mislabeled, stored on floor, missing or inadequate sneeze guards, food containers double stacked);";
    const v = parseViolations(raw);
    expect(v).toHaveLength(3);
    expect(v[0]).toEqual({
      code: "5B",
      critical: true,
      description:
        "Potentially hazardous foods are not cooled by an approved method where the food temperature can be reduced from 120oF to 70oF or less within two hours and 70oF to 45oF within four hours.",
    });
    expect(v[1]!.code).toBe("5C");
    expect(v[1]!.critical).toBe(true);
    expect(v[2]!.code).toBe("8A");
    expect(v[2]!.critical).toBe(false);
    expect(v[2]!.description.startsWith("Food not protected")).toBe(true);
    expect(v[2]!.description.endsWith("double stacked)")).toBe(true);
  });

  test("keeps semicolons that are inside a description", () => {
    const v = parseViolations("Item 15B-   Lighting inadequate; fixtures not shielded; Item 16-   Miscellaneous;");
    expect(v.map((x) => x.code)).toEqual(["15B", "16"]);
    expect(v[0]!.description).toBe("Lighting inadequate; fixtures not shielded");
  });

  test("odd spacing and a missing trailing semicolon", () => {
    const v = parseViolations("  Item 12E -Handwashing   facilities inaccessible  ");
    expect(v).toEqual([{ code: "12E", critical: false, description: "Handwashing facilities inaccessible" }]);
  });

  test("text that doesn't follow the item format is kept rather than dropped", () => {
    expect(parseViolations("Something unexpected")).toEqual([{ code: null, critical: false, description: "Something unexpected" }]);
  });
});
