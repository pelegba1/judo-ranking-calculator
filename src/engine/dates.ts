import type { CompetitionMeta } from './types';
import { CONTINENTAL_CH_DECAY_WEEK } from './rules/decay';

const DAY = 86_400_000;

function parse(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function format(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** ISO 8601 week-year and week number of a YYYY-MM-DD date. */
export function isoWeek(date: string): { year: number; week: number } {
  const t = parse(date);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // Mon=0
  const thursday = t + (3 - dow) * DAY;
  const year = new Date(thursday).getUTCFullYear();
  const week = Math.floor((thursday - Date.UTC(year, 0, 1)) / DAY / 7) + 1;
  return { year, week };
}

/** Monday (YYYY-MM-DD) of ISO week `week` of ISO year `year`. */
export function mondayOfIsoWeek(year: number, week: number): string {
  const jan4 = Date.UTC(year, 0, 4);
  const dow = (new Date(jan4).getUTCDay() + 6) % 7;
  return format(jan4 - dow * DAY + (week - 1) * 7 * DAY);
}

function weeksInYear(year: number): number {
  return isoWeek(format(Date.UTC(year, 11, 28))).week;
}

function mondayWrapped(year: number, week: number): string {
  return week > weeksInYear(year) ? mondayOfIsoWeek(year + 1, 1) : mondayOfIsoWeek(year, week);
}

/** Half-value and expiry dates (Mondays), based on the competition's dateFrom. */
export function decayDates(meta: CompetitionMeta): { half: string; expire: string } {
  const { year, week } = isoWeek(meta.dateFrom);
  const decayWeek = meta.eventType === 'continental_ch' ? CONTINENTAL_CH_DECAY_WEEK[meta.age] : week + 1;
  return { half: mondayWrapped(year + 1, decayWeek), expire: mondayWrapped(year + 2, decayWeek) };
}
