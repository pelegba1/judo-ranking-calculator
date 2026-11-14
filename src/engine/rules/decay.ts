import type { AgeGroup } from '../types';

/** ISO week (of the decay year) on which continental championship points decay. */
export const CONTINENTAL_CH_DECAY_WEEK: Record<AgeGroup, number> = { sen: 18, jun: 27, cad: 27 };
