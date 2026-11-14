import type { AgeGroup, EventType, Place } from '../types';

// Senior table, SOR 2026 section 3.2.1 (spec 5.1).
// Columns: 1 / 2 / 3 / 5 / 7 / 9 / 17 / one-win / participation.
const SENIOR: Record<EventType, number[] | undefined> = {
  continental_open: [100, 70, 50, 36, 26, 16, 12, 10, 2],
  continental_ch: [800, 560, 400, 288, 208, 128, 96, 80, 6],
  junior_world_ch: [700, 490, 350, 252, 182, 112, 84, 70, 6],
  grand_prix: [700, 490, 350, 252, 182, 112, 84, 70, 6],
  grand_slam: [1000, 700, 500, 360, 260, 160, 120, 100, 10],
  masters: [1800, 1260, 900, 648, 468, 288, 216, 0, 100],
  world_ch: [2000, 1400, 1000, 720, 520, 320, 240, 200, 20],
  olympic_games: [2200, 1540, 1100, 792, 572, 352, 264, 0, 0],
  continental_cup: undefined, // seniors: no points
};

// Junior/cadet table, SOR 2026 sections 3.2.2 / 3.2.3 (identical for both), extracted with pdftotext -table.
// Columns: 1 / 2 / 3 / 5 / 7 / 1-16 / 1-32 / 1-64 / each-contest-won / participation. null = empty cell.
// Results dated before 2026-01-01 keep the SOR 2025 values (JUN_CAD_PRE2026).
type JRow = (number | null)[];
const JUN_CAD_2026: Partial<Record<EventType, JRow>> = {
  continental_cup: [100, 70, 50, 40, 30, null, null, null, 6, 2],
  continental_ch: [300, 210, 150, 120, 90, null, null, null, 18, 4],
  grand_prix: [400, 280, 200, 160, 120, 64, 48, 40, 24, 6],
  world_ch: [700, 490, 350, 280, 210, 112, 84, 70, 42, 6],
};
/**
 * Pre-2026 junior/cadet values, read off official breakdown pages (Task 7, full value = shown points / percent;
 * juniors and cadets agree): continental cup 100/60/40/20/16, 2 per contest won, no participation points;
 * continental championship 200/120/80/40/32, 6 per contest won, participation 2; world championship 1st 500,
 * 2nd 300, 7th 80, 12 per contest won (9th is "fights won": no 1/16 column), participation 4.
 * UNVERIFIED: world championship 3rd 200 and 5th 100 (no page seen; the 5x-continental-cup pattern of 1st/2nd/7th),
 * and the grand prix row (no pre-2026 junior/cadet grand prix in the data window: 2026 values kept).
 */
const JUN_CAD_PRE2026: Partial<Record<EventType, JRow>> = {
  continental_cup: [100, 60, 40, 20, 16, null, null, null, 2, 0],
  continental_ch: [200, 120, 80, 40, 32, null, null, null, 6, 2],
  grand_prix: JUN_CAD_2026.grand_prix,
  world_ch: [500, 300, 200, 100, 80, null, null, null, 12, 4],
};

/**
 * Senior events whose participation column applies only from a date on. Continental opens before 2025 gave no
 * participation points (official breakdowns: no participation rows for the Nov 2024 opens, "7. place 0" without a
 * win; participation 2 from cont_open_mar2025, Jan 2025 on).
 */
const SENIOR_PARTICIPATION_FROM: Partial<Record<EventType, string>> = { continental_open: '2025-01-01' };

const SENIOR_IDX: Partial<Record<Place, number>> = { 1: 0, 2: 1, 3: 2, 5: 3, 7: 4, 9: 5, 17: 6 };
const JUN_IDX: Partial<Record<Place, number>> = { 1: 0, 2: 1, 3: 2, 5: 3, 7: 4, 9: 5, 17: 6, 33: 7 };

/**
 * Base points before domestic rule and decay.
 * Seniors: wins=0 -> participation; place 1..17 -> table; place 33+ -> "1 contest won" column.
 * Jun/cad (ASSUMPTION, validate in Task 7): places 1-7 -> that value; 9/17/33 (1/16, 1/32, 1/64) with wins>=1 ->
 * that column's value, or wins * each-contest-won when the cell is empty; lower than 1/64 with wins>=1 ->
 * wins * each-contest-won; wins=0 -> participation.
 */
export function basePoints(age: AgeGroup, event: EventType, place: Place, wins: number, eventDate: string): number {
  if (age === 'sen') {
    const row = SENIOR[event];
    if (!row) return 0;
    if (wins <= 0) return eventDate < (SENIOR_PARTICIPATION_FROM[event] ?? '') ? 0 : row[8];
    const i = SENIOR_IDX[place];
    return i === undefined ? row[7] : row[i];
  }
  const table = eventDate < '2026-01-01' ? JUN_CAD_PRE2026 : JUN_CAD_2026;
  const row = table[event];
  if (!row) return 0;
  if (wins <= 0) return row[9] ?? 0;
  const i = JUN_IDX[place];
  if (i !== undefined) {
    const v = row[i];
    if (v !== null) return v;
  }
  return wins * (row[8] ?? 0);
}
