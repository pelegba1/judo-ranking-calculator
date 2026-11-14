// Athlete search: name matching and country lists (pure, unit-tested).
import type { Person } from '../engine/types';

/** Lower case, accents removed ("Ðorđe" -> "dorde"), anything but letters/digits -> a space. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đð]/gi, 'd').replace(/ø/gi, 'o').replace(/ł/gi, 'l').replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Every word of the query appears in the name, in any order ("john smi" finds "SMITH John"). */
export function matchesName(name: string, query: string): boolean {
  const words = normalizeName(query).split(' ').filter(Boolean);
  if (!words.length) return false;
  const n = normalizeName(name);
  return words.every((w) => n.includes(w));
}

/** Shortest query worth searching by name alone (one letter matches thousands). */
export const MIN_QUERY = 2;

export const searchable = (query: string) => normalizeName(query).replace(/ /g, '').length >= MIN_QUERY;

/** Distinct country codes of the given athletes, sorted; `keep` (the selected one) is always included. */
export function countriesOf(ids: Iterable<number>, persons: ReadonlyMap<number, Person> | undefined, keep?: string): string[] {
  const out = new Set<string>();
  if (persons) for (const id of ids) { const c = persons.get(id)?.country; if (c) out.add(c); }
  if (keep) out.add(keep);
  return [...out].sort();
}
