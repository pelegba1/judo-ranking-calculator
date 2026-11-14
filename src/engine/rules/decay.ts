import type { AgeGroup } from '../types';

/** ISO week (of the decay year) on which continental championship points decay. */
export const CONTINENTAL_CH_DECAY_WEEK: Record<AgeGroup, number> = { sen: 18, jun: 27, cad: 27 };

export type Period = 'current' | 'previous' | 'expired';

/** Share of the base points a result is worth in each period (spec 5.1: 100% / 50% / 0%). */
export const PERIOD_FACTOR: Record<Period, number> = { current: 1, previous: 0.5, expired: 0 };

/** Period of a result on `rankingDate`, given its half-value and expiry Mondays (both exclusive upper bounds). */
export function periodOf(rankingDate: string, half: string, expire: string): Period {
  if (rankingDate < half) return 'current';
  if (rankingDate < expire) return 'previous';
  return 'expired';
}
