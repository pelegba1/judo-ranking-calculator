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
// UNVERIFIED pre-2026 jun/cad: results dated before 2026-01-01 should use the SOR 2025 table; not found, so
// the 2026 table is reused (see JUN_CAD_PRE2026). Task 7 validation will expose the gap.
type JRow = (number | null)[];
const JUN_CAD_2026: Partial<Record<EventType, JRow>> = {
  continental_cup: [100, 70, 50, 40, 30, null, null, null, 6, 2],
  continental_ch: [300, 210, 150, 120, 90, null, null, null, 18, 4],
  grand_prix: [400, 280, 200, 160, 120, 64, 48, 40, 24, 6],
  world_ch: [700, 490, 350, 280, 210, 112, 84, 70, 42, 6],
};
const JUN_CAD_PRE2026 = JUN_CAD_2026; // UNVERIFIED pre-2026 jun/cad

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
    if (wins <= 0) return row[8];
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
