// Nightly step for the LA28 Olympic ranking: the official Olympic points (competitor.wrl_current, one call per
// athlete), the date of that list, and how well the engine and the quota allocation reproduce it.
// Findings behind it: docs/research/olympic-points.md.
import type { RawWrlCurrent } from '../data/ijf-api';
import { officialCategory } from '../data/ids';
import { parseOlympicPage, type OlympicPageRow } from '../data/olympic-page';
import { allocateQuotas, completeOfficial, olympicPoints, statusIn, type OlympicStatusKind, type QuotaEntry } from '../engine/olympic';
import { project } from '../engine/projection';
import type { RankingEntry } from '../engine/ranking';
import type { OfficialPlace } from '../engine/rules/domestic';
import { WINDOW, continentOf } from '../engine/rules/la28';
import type { AthleteResult, CategoryKey, CompetitionMeta, Gender, Person } from '../engine/types';
import { addDays, mapLimit, mondayOnOrBefore, withRetry } from './util';

/** Athletes whose official Olympic points are fetched: the best of each category and of each continent and gender. */
export const OLYMPIC_FETCH_PER_CATEGORY = 40;
export const OLYMPIC_FETCH_PER_CONTINENT = 40;
const FETCH_CONCURRENCY = 6;
/** Below this share of successful calls the previous olympic-official.json is kept. */
export const MIN_FETCHED = 0.9;
/** Below this share of matched totals the engine is not trusted to date the official Olympic list. */
export const MIN_OLYMPIC_DATE_MATCH = 0.9;
/** On a first run, the official Olympic list is searched for from this many weeks back. */
const FIRST_RUN_WEEKS_BACK = 12;
const MAX_LISTED = 200;

/** Status as the site shows it; 'other' = a code outside the computed ones (returned quota, invitation, ...). */
export type OfficialOlympicStatus = OlympicStatusKind | 'other';
const STATUS_BY_CODE: Record<number, OlympicStatusKind> = { 0: 'out', 1: 'direct', 2: 'continental', 3: 'noc_blocked', 4: 'host' };
export const statusOfCode = (code: number | null): OfficialOlympicStatus => (code === null ? 'out' : STATUS_BY_CODE[code] ?? 'other');

/** One athlete of the official Olympic list. `points` 0 = asked, no Olympic points. */
export interface OlympicOfficialEntry {
  idPerson: number; category: CategoryKey; points: number; place: number | null;
  status: OfficialOlympicStatus; qStatus: number | null;
}
/**
 * olympic-official.json. `date`: the Monday of the official list the API's Olympic fields belong to (they lag the
 * WRL); null when unknown. Athletes not listed were not asked (the site falls back to the engine for them).
 */
export interface OlympicOfficialFile { date: string | null; entries: OlympicOfficialEntry[] }

export interface OlympicValidation {
  date: string | null;
  /** Athletes asked / answered. */
  asked: number; fetched: number;
  checked: number; matched: number;
  mismatches: { idPerson: number; category: CategoryKey; official: number; engine: number }[];
  /** Computed status (allocation on the official points; engine points for athletes not asked) vs q_status. */
  status: { checked: number; agreed: number; byOfficial: Partial<Record<OfficialOlympicStatus, { checked: number; agreed: number }>>;
    disagreements: { idPerson: number; category: CategoryKey; official: OfficialOlympicStatus; computed: OlympicStatusKind }[] };
  /** The ijf.org page (top 24 per gender, current) against the engine on its best-matching Monday. */
  page: { date: string | null; checked: number; matched: number };
}

/** Senior Olympic rows of a wrl_current answer. */
export function toOlympicEntries(idPerson: number, rows: RawWrlCurrent[]): OlympicOfficialEntry[] {
  const out: OlympicOfficialEntry[] = [];
  for (const r of rows ?? []) {
    if (r.age !== 'Seniors') continue;
    const idWeight = Number(r.id_weight);
    const category = officialCategory(idWeight <= 7 ? 1 : 2, idWeight);
    if (!category) continue;
    const qStatus = r.q_status === null || r.q_status === undefined || r.q_status === '' ? null : Number(r.q_status);
    out.push({
      idPerson, category,
      points: Number(r.ogq_sum_points ?? 0) || 0,
      place: r.ogq_place === null || r.ogq_place === undefined || r.ogq_place === '' ? null : Number(r.ogq_place),
      status: statusOfCode(qStatus), qStatus,
    });
  }
  return out;
}

/** Ids to ask: the top `perCategory` of each category and the top `perContinent` of each continent and gender. */
export function olympicCandidates(
  ranking: Map<CategoryKey, RankingEntry[]>, persons: ReadonlyMap<number, Person>,
  perCategory = OLYMPIC_FETCH_PER_CATEGORY, perContinent = OLYMPIC_FETCH_PER_CONTINENT,
): number[] {
  const ids = new Set<number>();
  const byGroup = new Map<string, RankingEntry[]>();
  for (const [cat, entries] of ranking) {
    for (const e of entries.slice(0, perCategory)) ids.add(e.idPerson);
    for (const e of entries) {
      const continent = continentOf(persons.get(e.idPerson)?.continent);
      if (!continent) continue;
      const key = `${continent}|${cat[4]}`;
      byGroup.set(key, [...(byGroup.get(key) ?? []), e]);
    }
  }
  for (const list of byGroup.values()) {
    for (const e of list.sort((a, b) => b.points - a.points || a.idPerson - b.idPerson).slice(0, perContinent)) ids.add(e.idPerson);
  }
  return [...ids].sort((a, b) => a - b);
}

type Totals = Map<CategoryKey, Map<number, number>>;
const totalsOf = (r: Map<CategoryKey, RankingEntry[]>): Totals =>
  new Map([...r].map(([cat, es]) => [cat, new Map(es.map((e) => [e.idPerson, e.points]))]));

function compare(rows: { idPerson: number; category: CategoryKey; points: number }[], totals: Totals) {
  let matched = 0;
  const mismatches: OlympicValidation['mismatches'] = [];
  for (const o of rows) {
    const engine = totals.get(o.category)?.get(o.idPerson) ?? 0;
    if (Math.abs(engine - o.points) < 0.5) matched++;
    else mismatches.push({ idPerson: o.idPerson, category: o.category, official: o.points, engine });
  }
  return { checked: rows.length, matched, mismatches };
}

/** The Monday from `start` up to the last Monday on or before `today` where the engine matches most rows (ties: earlier). */
function bestMonday(rows: { idPerson: number; category: CategoryKey; points: number }[], start: string, today: string, totalsAt: (d: string) => Totals) {
  let best = { date: start, matched: -1 };
  const tried: string[] = [];
  for (let d = mondayOnOrBefore(start); d <= mondayOnOrBefore(today); d = addDays(d, 7)) {
    const { matched } = compare(rows, totalsAt(d));
    tried.push(`${d}: ${matched}/${rows.length}`);
    if (matched > best.matched) best = { date: d, matched };
  }
  return { ...best, tried };
}

/**
 * Statuses from the official list: the allocation runs on the official points (engine points for athletes not
 * asked, so the continental lists are complete) and is compared with q_status for every asked athlete with points.
 */
export function statusAgreement(entries: OlympicOfficialEntry[], engine: Map<CategoryKey, RankingEntry[]>, persons: ReadonlyMap<number, Person>): OlympicValidation['status'] {
  const official = completeOfficial(entries.map((e) => ({ ...e, place: e.place ?? 0 })), engine);
  const projected = project(official, engine, engine);
  const ranking = new Map<CategoryKey, QuotaEntry[]>();
  for (const [cat, list] of projected) {
    ranking.set(cat, list.filter((p) => p.projectedPoints > 0).map((p) => ({
      idPerson: p.idPerson, category: cat, points: p.projectedPoints, place: p.projectedPlace, results: p.engine?.results,
    })));
  }
  const computed = allocateQuotas(ranking, persons);
  const out: OlympicValidation['status'] = { checked: 0, agreed: 0, byOfficial: {}, disagreements: [] };
  for (const e of entries) {
    if (e.points <= 0 || e.status === 'other') continue;
    const c = statusIn(computed, e.idPerson, e.category, 0).kind;
    const agreed = c === e.status;
    out.checked++;
    if (agreed) out.agreed++;
    const k = (out.byOfficial[e.status] ??= { checked: 0, agreed: 0 });
    k.checked++;
    if (agreed) k.agreed++;
    else if (out.disagreements.length < MAX_LISTED) out.disagreements.push({ idPerson: e.idPerson, category: e.category, official: e.status, computed: c });
  }
  return out;
}

export interface OlympicStepInput {
  results: AthleteResult[]; comps: Map<number, CompetitionMeta>; officialPlace: OfficialPlace;
  persons: ReadonlyMap<number, Person>; today: string;
  previous: OlympicOfficialFile | null;
  wrlCurrent: (idPerson: number) => Promise<RawWrlCurrent[]>;
  pageHtml: (gender: Gender) => Promise<string>;
  retryDelayMs?: number;
  log?: (msg: string) => void;
}
export interface OlympicStepOutput { file: OlympicOfficialFile; validation: OlympicValidation; warnings: string[] }

export async function olympicStep(input: OlympicStepInput): Promise<OlympicStepOutput> {
  const { results, comps, officialPlace, persons, today } = input;
  // a previous file without entries (a failed first run) is no previous list
  const previous = input.previous?.entries?.length ? input.previous : null;
  const log = input.log ?? (() => {});
  const retry = <T>(fn: () => Promise<T>) => withRetry(fn, 2, input.retryDelayMs ?? 1000);
  const warnings: string[] = [];
  const cache = new Map<string, Map<CategoryKey, RankingEntry[]>>();
  const engineAt = (date: string) => {
    let r = cache.get(date);
    if (!r) {
      r = olympicPoints(results.filter((x) => comps.get(x.competitionId)!.dateTo < date), comps, date, officialPlace);
      cache.set(date, r);
    }
    return r;
  };
  const totalsAt = (date: string) => totalsOf(engineAt(date));

  // 1. official points of the candidates
  const candidates = olympicCandidates(engineAt(today), persons);
  let failed = 0;
  const answers = await mapLimit(candidates, FETCH_CONCURRENCY, async (id) => {
    try {
      return toOlympicEntries(id, await retry(() => input.wrlCurrent(id)));
    } catch {
      failed++;
      return [];
    }
  });
  const fetched = candidates.length - failed;
  let file: OlympicOfficialFile;
  let fresh = true;
  if (candidates.length > 0 && fetched < MIN_FETCHED * candidates.length) {
    fresh = false;
    file = previous ?? { date: null, entries: [] };
    warnings.push(`olympic: competitor.wrl_current answered for ${fetched}/${candidates.length} athletes; `
      + (previous ? 'keeping the previous olympic-official.json' : 'no previous olympic-official.json: no official Olympic data'));
  } else {
    file = { date: null, entries: answers.flat().sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : b.points - a.points || a.idPerson - b.idPerson)) };
  }
  log(`olympic: asked ${candidates.length} athletes, ${fetched} answered, ${file.entries.filter((e) => e.points > 0).length} with Olympic points`);

  // 2. the official list's date: best match, never before the previous one
  const withPoints = file.entries.filter((e) => e.points > 0);
  if (fresh && withPoints.length) {
    const firstRun = addDays(mondayOnOrBefore(today), -7 * FIRST_RUN_WEEKS_BACK);
    const start = previous?.date ?? (firstRun < WINDOW.from ? WINDOW.from : firstRun);
    const best = bestMonday(withPoints, start, today, totalsAt);
    log(`olympic official date: ${best.tried.join(', ')} -> ${best.date}`);
    const rate = best.matched / withPoints.length;
    if (rate < MIN_OLYMPIC_DATE_MATCH) {
      file.date = previous?.date ?? null;
      warnings.push(`olympic: best match ${(100 * rate).toFixed(1)}% (${best.matched}/${withPoints.length} on ${best.date}) is below `
        + `${100 * MIN_OLYMPIC_DATE_MATCH}%; ${file.date ? `keeping ${file.date}` : 'official Olympic date unknown'}`);
    } else file.date = best.date;
  } else if (fresh) {
    file.date = previous?.date ?? null;
  }

  // 3. validation: engine totals and statuses on that date
  const validation: OlympicValidation = {
    date: file.date, asked: candidates.length, fetched, checked: 0, matched: 0, mismatches: [],
    status: { checked: 0, agreed: 0, byOfficial: {}, disagreements: [] }, page: { date: null, checked: 0, matched: 0 },
  };
  if (file.date) {
    const c = compare(withPoints, totalsAt(file.date));
    Object.assign(validation, { checked: c.checked, matched: c.matched, mismatches: c.mismatches.slice(0, MAX_LISTED) });
    validation.status = statusAgreement(file.entries, engineAt(file.date), persons);
  }

  // 4. the ijf.org page (current, top 24 per gender)
  try {
    const rows: OlympicPageRow[] = [];
    for (const g of ['m', 'f'] as Gender[]) rows.push(...parseOlympicPage(await retry(() => input.pageHtml(g))));
    const best = bestMonday(rows, file.date ?? addDays(mondayOnOrBefore(today), -7 * FIRST_RUN_WEEKS_BACK), today, totalsAt);
    validation.page = { date: best.date, checked: rows.length, matched: Math.max(best.matched, 0) };
  } catch (e) {
    warnings.push(`olympic: ijf.org Olympic page not read: ${e instanceof Error ? e.message : e}`);
  }

  const pct = (m: number, n: number) => (n ? `${((100 * m) / n).toFixed(2)}%` : 'n/a');
  log(`olympic validation (list ${file.date ?? '?'}): ${validation.matched}/${validation.checked} = ${pct(validation.matched, validation.checked)}; `
    + `status ${validation.status.agreed}/${validation.status.checked} = ${pct(validation.status.agreed, validation.status.checked)} `
    + `(${Object.entries(validation.status.byOfficial).map(([k, v]) => `${k} ${v.agreed}/${v.checked}`).join(', ')}); `
    + `page ${validation.page.matched}/${validation.page.checked} on ${validation.page.date ?? '?'}`);
  return { file, validation, warnings };
}
