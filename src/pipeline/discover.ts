// Finds the competitions that give ranking points. competition.get_list only lists senior events, so junior and
// cadet events are found by scanning competition.info ids (ids are sequential; unused ids answer null).
import { getCompetitionList, type RawCompetition, type RawCompetitionInfo } from '../data/ijf-api';
import { normaliseDate, toCompetitionMeta, type RawCompetitionLike } from '../data/competition-loader';
import type { CompetitionMeta } from '../engine/types';
import { addDays, addMonths, mapLimit } from './util';

export const WINDOW_MONTHS = 26; // competitions kept: dateTo within the last 26 months ...
export const DAYS_AHEAD = 60; // ... up to dateFrom 60 days ahead
export const SCAN_BACK = 50;
export const SCAN_AHEAD = 150;
export const MAX_EMPTY = 40;
/** Indexed competitions that ended within this many days get their info (updated_at_ts) re-read every run. */
export const REFRESH_DAYS = 30;

/** One competition.info / get_list row, as kept in data-cache/competition-index.json (classified or not). */
export interface IndexEntry {
  id: number; code: string; name: string; dateFrom: string; dateTo: string; hostCountry: string; updatedAt: string;
}
export interface CompetitionIndex {
  /** Highest id competition.info returned a competition for; the next scan starts SCAN_BACK below it. */
  scannedMax: number;
  competitions: Record<string, IndexEntry>;
}

export const emptyIndex = (): CompetitionIndex => ({ scannedMax: 0, competitions: {} });

export interface DiscoverOptions {
  fetchList?: (year: number) => Promise<RawCompetition[]>;
  today?: string; // YYYY-MM-DD
  concurrency?: number;
  log?: (msg: string) => void;
}

function toEntry(raw: RawCompetitionLike & { updated_at_ts?: unknown }): IndexEntry {
  return {
    id: Number(raw.id_competition), code: String(raw.competition_code ?? ''), name: String(raw.name ?? ''),
    dateFrom: normaliseDate(raw.date_from), dateTo: normaliseDate(raw.date_to),
    hostCountry: String(raw.country_short ?? ''), updatedAt: String(raw.updated_at_ts ?? ''),
  };
}

export const entryMeta = (e: IndexEntry): CompetitionMeta | null =>
  toCompetitionMeta({
    id_competition: e.id, competition_code: e.code, name: e.name, date_from: e.dateFrom, date_to: e.dateTo,
    country_short: e.hostCountry,
  });

/**
 * Updates `index` in place (list rows, scanned ids, refreshed infos) and returns the classified competitions with
 * dateTo within the last WINDOW_MONTHS and dateFrom at most DAYS_AHEAD ahead, ordered by dateFrom then id.
 * Senior events come from competition.get_list; all ids from `max(scannedMax) - SCAN_BACK` (first run: the lowest
 * listed id dated within the window, minus SCAN_BACK) up to `max(known ids) + SCAN_AHEAD` are read with
 * competition.info, stopping after MAX_EMPTY consecutive unused ids beyond the highest known id.
 * A failing info call is logged and skipped (its id is retried by a later run only if it is in the rescan window).
 */
export async function discoverCompetitions(
  knownIndex: CompetitionIndex,
  fetchInfo: (id: number) => Promise<RawCompetitionInfo | null>,
  opts: DiscoverOptions = {},
): Promise<CompetitionMeta[]> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const fetchList = opts.fetchList ?? getCompetitionList;
  const concurrency = opts.concurrency ?? 6;
  const log = opts.log ?? (() => {});
  const windowStart = addMonths(today, -WINDOW_MONTHS);
  const windowEnd = addDays(today, DAYS_AHEAD);
  const index = knownIndex;

  // 1. senior events from the list, every year the window touches
  const listed: IndexEntry[] = [];
  for (let y = Number(windowStart.slice(0, 4)); y <= Number(windowEnd.slice(0, 4)); y++) {
    try {
      for (const row of await fetchList(y)) listed.push(toEntry(row));
    } catch (e) {
      // the index still holds last run's rows; a first run cannot start without the list (see below)
      log(`competition list ${y} failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  for (const e of listed) index.competitions[String(e.id)] = e;

  // 2. scan ids with competition.info
  const knownMax = Math.max(index.scannedMax, ...Object.values(index.competitions).map((e) => e.id), 0);
  let start: number;
  if (index.scannedMax > 0) start = index.scannedMax - SCAN_BACK;
  else {
    const inWindow = listed.filter((e) => e.dateFrom >= windowStart).map((e) => e.id);
    if (!inWindow.length) throw new Error('discoverCompetitions: empty index and no listed competition to start the scan from');
    start = Math.min(...inWindow) - SCAN_BACK;
  }
  const end = knownMax + SCAN_AHEAD;
  log(`scanning competition ids ${start}..${end} (stopping after ${MAX_EMPTY} unused ids beyond ${knownMax})`);
  let empty = 0;
  let next = Math.max(1, start);
  scan: while (next <= end) {
    const batch: number[] = [];
    for (let i = 0; i < concurrency && next <= end; i++) batch.push(next++);
    const infos = await Promise.all(batch.map(async (id) => {
      try {
        return { id, info: await fetchInfo(id), failed: false };
      } catch (e) {
        log(`competition.info ${id} failed: ${e instanceof Error ? e.message : e}`);
        return { id, info: null, failed: true };
      }
    }));
    for (const { id, info, failed } of infos) {
      if (info) {
        index.competitions[String(id)] = toEntry(info);
        index.scannedMax = Math.max(index.scannedMax, id);
        empty = 0;
      } else if (!failed && id > knownMax && ++empty >= MAX_EMPTY) break scan;
    }
    if ((next - start) % 120 < batch.length) log(`  scanned up to ${next - 1}`);
  }

  // 3. re-read recent competitions below the scan window, so a changed updated_at_ts is noticed
  const listedIds = new Set(listed.map((e) => e.id));
  const refresh = Object.values(index.competitions).filter((e) =>
    e.id < start && !listedIds.has(e.id) && e.dateTo >= addDays(today, -REFRESH_DAYS) && e.dateFrom <= windowEnd
    && entryMeta(e) !== null);
  await mapLimit(refresh, concurrency, async (e) => {
    try {
      const info = await fetchInfo(e.id);
      if (info) index.competitions[String(e.id)] = toEntry(info);
    } catch (err) {
      log(`competition.info ${e.id} refresh failed: ${err instanceof Error ? err.message : err}`);
    }
  });

  return Object.values(index.competitions)
    .filter((e) => e.dateTo >= windowStart && e.dateFrom <= windowEnd)
    .map(entryMeta)
    .filter((m): m is CompetitionMeta => m !== null)
    .sort((a, b) => (a.dateFrom < b.dateFrom ? -1 : a.dateFrom > b.dateFrom ? 1 : a.id - b.id));
}
