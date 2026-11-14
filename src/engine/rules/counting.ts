import type { AgeGroup, EventType } from '../types';
import type { Period } from './decay';

// Which scored results count towards an athlete's total, and how equal totals are ordered.
// Spec 5.1 (SOR 2026 sections 3.1-3.2).

/** The parts of a scored result that the counting and tie-break rules look at. */
export interface Countable {
  value: number;
  period: Period;
  meta: { id: number; eventType: EventType; dateFrom: string };
}

const COUNTING_PERIODS = ['current', 'previous'] as const;

/** Seniors: best N results (by value) in each period. */
export const SENIOR_BEST_PER_PERIOD = 6;

/** Juniors/cadets, in each period: best N of `bestOf`, plus the latest result of each `latestOf` event type. */
export const JUN_CAD_COUNTING = {
  bestOf: { events: ['grand_prix', 'continental_cup'] as EventType[], n: 3 },
  latestOf: ['continental_ch', 'world_ch'] as EventType[],
};

/** Tie-break steps after equal points: sum of counted values of these event types, or the single counted values. */
export type TieBreak = { sumOf: EventType[] } | 'singleValues';

export const TIE_BREAKS: Record<AgeGroup, TieBreak[]> = {
  sen: [{ sumOf: ['world_ch'] }, { sumOf: ['grand_prix', 'grand_slam', 'masters'] }, 'singleValues'],
  jun: [{ sumOf: ['world_ch'] }, { sumOf: ['grand_prix'] }, { sumOf: ['continental_ch'] },
    { sumOf: ['continental_cup'] }, 'singleValues'],
  cad: [{ sumOf: ['world_ch'] }, { sumOf: ['grand_prix'] }, { sumOf: ['continental_ch'] },
    { sumOf: ['continental_cup'] }, 'singleValues'],
};

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Best first: higher value, then more recent, then lower competition id (deterministic). */
const byValue = (a: Countable, b: Countable) =>
  b.value - a.value || cmpStr(b.meta.dateFrom, a.meta.dateFrom) || a.meta.id - b.meta.id;

/** Latest first: later dateFrom, then lower competition id. */
const byLatest = (a: Countable, b: Countable) => cmpStr(b.meta.dateFrom, a.meta.dateFrom) || a.meta.id - b.meta.id;

/**
 * The results (all of one athlete in one category) that count towards the total.
 * Only results with value > 0 are returned: expired and domestic-excluded results never count.
 * Jun/cad "latest" picks the latest event of that type in the period even if it is worth less than an earlier one.
 */
export function selectCounted<T extends Countable>(view: AgeGroup, results: T[]): Set<T> {
  const chosen: T[] = [];
  for (const period of COUNTING_PERIODS) {
    const inPeriod = results.filter((r) => r.period === period);
    if (view === 'sen') {
      chosen.push(...[...inPeriod].sort(byValue).slice(0, SENIOR_BEST_PER_PERIOD));
      continue;
    }
    const { bestOf, latestOf } = JUN_CAD_COUNTING;
    chosen.push(...inPeriod.filter((r) => bestOf.events.includes(r.meta.eventType)).sort(byValue).slice(0, bestOf.n));
    for (const event of latestOf) {
      const latest = inPeriod.filter((r) => r.meta.eventType === event).sort(byLatest)[0];
      if (latest) chosen.push(latest);
    }
  }
  return new Set(chosen.filter((r) => r.value > 0));
}

const sumOf = (rs: Countable[], events: EventType[]) =>
  rs.reduce((s, r) => s + (events.includes(r.meta.eventType) ? r.value : 0), 0);

/**
 * Tie-break between two athletes with equal points, given their counted results.
 * Negative when `a` ranks higher, positive when `b` does, 0 when still tied.
 */
export function compareTied(view: AgeGroup, a: Countable[], b: Countable[]): number {
  for (const step of TIE_BREAKS[view]) {
    if (step === 'singleValues') {
      const va = a.map((r) => r.value).sort((x, y) => y - x);
      const vb = b.map((r) => r.value).sort((x, y) => y - x);
      for (let i = 0; i < Math.max(va.length, vb.length); i++) {
        const d = (vb[i] ?? 0) - (va[i] ?? 0);
        if (d !== 0) return d;
      }
      continue;
    }
    const d = sumOf(b, step.sumOf) - sumOf(a, step.sumOf);
    if (d !== 0) return d;
  }
  return 0;
}
