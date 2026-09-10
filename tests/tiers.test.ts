import { expect, test } from "bun:test";
import { criticalTier, type CriticalTier } from "../src/client/tiers.ts";

const cases: [count: number, tier: CriticalTier][] = [
  [0, 0],
  [1, 1],
  [2, 2],
  [3, 2],
  [4, 3],
  [15, 3],
];

test.each(cases)("%i critical violations → tier %i", (count, tier) => {
  expect(criticalTier(count)).toBe(tier);
});
