/**
 * Group critical-violation counts into a few visual steps. Most flagged places
 * have exactly one, so a handful of steps reads better than a continuous scale.
 *   0 → none, 1 → one, 2 → two or three, 3 → four or more
 */
export type CriticalTier = 0 | 1 | 2 | 3;

export function criticalTier(n: number): CriticalTier {
  if (n >= 4) return 3;
  if (n >= 2) return 2;
  if (n >= 1) return 1;
  return 0;
}
