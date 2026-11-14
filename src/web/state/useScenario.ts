// The "what if" scenario: view (age, gender, weight), added competitions and target date. Kept in the URL hash,
// e.g. #/sen/m/-60?add=3159,3169&date=2026-11-16. Pure logic first; the React hook at the end.
import { useCallback, useEffect, useState } from 'react';
import { computeRanking, type RankingEntry } from '../../engine/ranking';
import { project, type OfficialEntry, type ProjectedEntry } from '../../engine/projection';
import { WEIGHTS } from '../../engine/rules/categories';
import { competitionInView } from '../../engine/rules/views';
import type { OfficialPlace } from '../../engine/rules/domestic';
import type { AgeGroup, AthleteResult, CategoryKey, CompetitionMeta, Gender } from '../../engine/types';
import type { AgeGender } from '../../data/ids';
import { decodeWatchlist, encodeWatchlist } from './watchlist';

export const AGES: AgeGroup[] = ['sen', 'jun', 'cad'];
export const GENDERS: Gender[] = ['m', 'f'];

/** What the URL hash holds. `date` null = the default target date. */
export interface ScenarioHash {
  age: AgeGroup; gender: Gender; weight: string; added: number[]; date: string | null;
  /** Athlete breakdown open (#/sen/m/-60/athlete/20144); absent = the category table. */
  athlete?: number;
  /** The watch list screen (#/watch); age/gender/weight are then unused defaults. */
  watch?: boolean;
  /** Athlete ids of a shared link (#/watch?ids=1,2): offered to the user, then dropped from the hash. */
  ids?: number[];
}
/** The scenario the projection runs on. */
export interface Scenario { age: AgeGroup; gender: Gender; weight: string; added: number[]; targetDate: string }

export const DEFAULT_HASH: ScenarioHash = { age: 'sen', gender: 'm', weight: '-60', added: [], date: null };

// ---------- dates ----------

const DAY = 86_400_000;
const ms = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** A real calendar date written YYYY-MM-DD. */
export function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && iso(ms(s)) === s;
}

/** The first Monday strictly after `date` (Sunday 2026-11-15 -> 2026-11-16, Monday -> the next one). */
export function mondayAfter(date: string): string {
  const t = ms(date);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // Mon=0
  return iso(t + (7 - dow) * DAY);
}

const maxDate = (ds: string[]) => ds.reduce((a, b) => (b > a ? b : a), '');

/** Latest official list date of an age group (the two genders' lists can differ). */
export function officialDateOf(officialDates: Record<AgeGender, string>, age: AgeGroup): string {
  return maxDate([officialDates[`${age}-m`], officialDates[`${age}-f`]]);
}

/** Monday after the latest added competition; nothing added -> the official date. Never before the official date. */
export function defaultTargetDate(added: CompetitionMeta[], officialDates: Record<AgeGender, string>, age: AgeGroup): string {
  const official = officialDateOf(officialDates, age);
  if (!added.length) return official;
  return maxDate([official, mondayAfter(maxDate(added.map((c) => c.dateTo)))]);
}

// ---------- hash ----------

function decode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

/** Parse a location hash; anything unknown falls back to the defaults, bad ids and dates are dropped. */
export function parseHash(hash: string): ScenarioHash {
  const h = hash.replace(/^#/, '');
  const q = h.indexOf('?');
  const path = (q >= 0 ? h.slice(0, q) : h).split('/').filter(Boolean);
  const query = new URLSearchParams(q >= 0 ? h.slice(q + 1) : '');

  const age = (AGES as string[]).includes(path[0]) ? (path[0] as AgeGroup) : DEFAULT_HASH.age;
  const gender = (GENDERS as string[]).includes(path[1]) ? (path[1] as Gender) : DEFAULT_HASH.gender;
  let w = path[2] !== undefined ? decode(path[2]) : null;
  if (w && w.startsWith(' ')) w = `+${w.slice(1)}`; // a '+' read as a space
  const weights = WEIGHTS[age][gender];
  const weight = w && weights.includes(w) ? w : weights[0];

  const added: number[] = [];
  for (const s of (query.get('add') ?? '').split(',')) {
    if (!/^\d+$/.test(s.trim())) continue;
    const id = Number(s.trim());
    if (id > 0 && Number.isSafeInteger(id) && !added.includes(id)) added.push(id);
  }
  const d = query.get('date') ?? '';
  const out: ScenarioHash = { age, gender, weight, added, date: isIsoDate(d) ? d : null };
  if (path[0] === 'watch') {
    out.watch = true;
    const ids = decodeWatchlist(query.get('ids') ?? '');
    if (ids.length) out.ids = ids;
    return out;
  }
  if (path[3] === 'athlete' && /^\d+$/.test(path[4] ?? '')) {
    const id = Number(path[4]);
    if (id > 0 && Number.isSafeInteger(id)) out.athlete = id;
  }
  return out;
}

export function formatHash(s: ScenarioHash): string {
  const params: string[] = [];
  if (s.watch && s.ids?.length) params.push(`ids=${encodeWatchlist(s.ids)}`);
  if (s.added.length) params.push(`add=${s.added.join(',')}`);
  if (s.date) params.push(`date=${s.date}`);
  const query = params.length ? `?${params.join('&')}` : '';
  if (s.watch) return `#/watch${query}`;
  return `#/${s.age}/${s.gender}/${encodeURIComponent(s.weight)}${s.athlete ? `/athlete/${s.athlete}` : ''}${query}`;
}

// ---------- competitions ----------

/** Whether a competition gives points in the `age` ranking (a junior world championship also counts for seniors). */
export const appliesTo = (c: CompetitionMeta, age: AgeGroup) => competitionInView(c, age) !== null;

/** Weight at the same position in another age/gender's list (the first one when out of range). */
export function mapWeight(weight: string, from: { age: AgeGroup; gender: Gender }, to: { age: AgeGroup; gender: Gender }): string {
  const target = WEIGHTS[to.age][to.gender];
  if (target.includes(weight) && from.gender === to.gender) return weight;
  const i = WEIGHTS[from.age][from.gender].indexOf(weight);
  return target[Math.min(Math.max(i, 0), target.length - 1)];
}

/** The hash after switching the view; added competitions that give no points in the new age are dropped. */
export function withView(
  h: ScenarioHash, to: { age?: AgeGroup; gender?: Gender }, comps: Map<number, CompetitionMeta>,
): ScenarioHash {
  const age = to.age ?? h.age;
  const gender = to.gender ?? h.gender;
  const weight = mapWeight(h.weight, h, { age, gender });
  const added = age === h.age ? h.added : h.added.filter((id) => {
    const c = comps.get(id);
    return !c || appliesTo(c, age);
  });
  const { athlete: _athlete, watch: _watch, ids: _ids, ...rest } = h;
  return { ...rest, age, gender, weight, added };
}

export interface AddOutcome {
  outcome: 'added' | 'already_added' | 'already_official';
  /** The view was switched to the competition's own age group. */
  switched: boolean;
  /** The hash to set; null when nothing changes. */
  next: ScenarioHash | null;
}

/**
 * Add a competition to `h` (pass the latest hash: the lookup before this may have taken seconds). A competition
 * that gives no points in the view's age group switches the view to its own age group; one that every list of
 * that age group already includes is not added.
 */
export function addCompetitionToHash(
  h: ScenarioHash, c: CompetitionMeta, comps: Map<number, CompetitionMeta>, officialDates: Record<AgeGender, string>,
): AddOutcome {
  const all = comps.has(c.id) ? comps : new Map(comps).set(c.id, c);
  const switched = !appliesTo(c, h.age);
  const view = switched ? withView(h, { age: c.age }, all) : h;
  if (c.dateTo < officialDates[`${view.age}-m`] && c.dateTo < officialDates[`${view.age}-f`]) {
    return { outcome: 'already_official', switched: false, next: null };
  }
  if (view.added.includes(c.id)) return { outcome: 'already_added', switched, next: view };
  return { outcome: 'added', switched, next: { ...view, added: [...view.added, c.id] } };
}

export interface PendingMeta {
  officialDates: Record<AgeGender, string>;
  competitions: (CompetitionMeta & { hasResults: boolean })[];
}

/**
 * Competitions with results that the official `age` list does not include yet (for at least one gender), newest
 * first. For seniors this includes junior world championships, which score in the senior ranking.
 */
export function pendingCompetitions(meta: PendingMeta, age: AgeGroup): (CompetitionMeta & { hasResults: boolean })[] {
  const since = [meta.officialDates[`${age}-m`], meta.officialDates[`${age}-f`]].reduce((a, b) => (b < a ? b : a));
  return meta.competitions
    .filter((c) => c.hasResults && c.dateTo >= since && appliesTo(c, age))
    .sort((a, b) => (a.dateTo < b.dateTo ? 1 : a.dateTo > b.dateTo ? -1 : b.id - a.id));
}

/** How many weight categories of a competition are finished (their Final was fought). */
export function competitionProgress(results: AthleteResult[]): { finished: number; total: number } {
  const all = new Set<string>();
  const done = new Set<string>();
  for (const r of results) {
    const k = r.gender + r.weight;
    all.add(k);
    if (r.categoryFinished) done.add(k);
  }
  return { finished: done.size, total: all.size };
}

/** The scenario the projection runs on: explicit date from the hash, else the default from the added competitions. */
export function resolveScenario(
  h: ScenarioHash, comps: Map<number, CompetitionMeta>, officialDates: Record<AgeGender, string>,
): Scenario & { dateIsAuto: boolean } {
  const added = h.added.map((id) => comps.get(id)).filter((c): c is CompetitionMeta => !!c && appliesTo(c, h.age));
  const targetDate = h.date ?? defaultTargetDate(added, officialDates, h.age);
  return { age: h.age, gender: h.gender, weight: h.weight, added: h.added, targetDate, dateIsAuto: h.date === null };
}

// ---------- projection ----------

export interface ProjectionData {
  officialDates: Record<AgeGender, string>;
  /** Every known competition: meta.json plus competitions resolved live. */
  comps: Map<number, CompetitionMeta>;
  /** Official entries of the view's age group, plus juniors for the senior view (domestic-rule tie-break). */
  official: OfficialEntry[];
  /** Nightly results by competition id, for every age group the view draws on. */
  results: Record<string, AthleteResult[]>;
  /** Results loaded live in the browser; they replace the nightly ones of an added competition. */
  live: Record<string, AthleteResult[]>;
}

function officialPlaceLookup(official: OfficialEntry[]): OfficialPlace {
  const m = new Map(official.map((o) => [`${o.idPerson}|${o.category}`, o.place]));
  return (id, cat) => m.get(`${id}|${cat}`);
}

// `before` depends only on the nightly results, the official list and (age, gender, official date): it is
// recomputed only when one of those changes (toggling a competition or the date does not).
const beforeCache = new WeakMap<object, WeakMap<object, Map<string, Map<CategoryKey, RankingEntry[]>>>>();
function memoBefore(data: ProjectionData, key: string, compute: () => Map<CategoryKey, RankingEntry[]>) {
  let byOfficial = beforeCache.get(data.results);
  if (!byOfficial) beforeCache.set(data.results, (byOfficial = new WeakMap()));
  let m = byOfficial.get(data.official);
  if (!m) byOfficial.set(data.official, (m = new Map()));
  let r = m.get(key);
  if (!r) m.set(key, (r = compute()));
  return r;
}

/**
 * The projected `scenario.age` ranking, both genders. Per gender (each has its own official date): `before` = the
 * engine on the official date over the competitions that ended before it; `after` = the same plus the added
 * competitions, on the target date; then official + (after - before). Added ids that are unknown, already in the
 * official list or give no points in this age group change nothing.
 */
export function buildProjection(data: ProjectionData, scenario: Scenario): Map<CategoryKey, ProjectedEntry[]> {
  const { age } = scenario;
  const officialPlace = officialPlaceLookup(data.official);
  const inView = [...data.comps.values()].filter((c) => appliesTo(c, age));
  const out = new Map<CategoryKey, ProjectedEntry[]>();
  for (const gender of GENDERS) {
    const date = data.officialDates[`${age}-${gender}`];
    const ofGender = (rs: AthleteResult[] | undefined) => (rs ?? []).filter((r) => r.gender === gender);
    const baseIds = new Set(inView.filter((c) => c.dateTo < date).map((c) => c.id));
    const base = [...baseIds].flatMap((id) => ofGender(data.results[id]));
    const extra = scenario.added
      .filter((id, i, a) => a.indexOf(id) === i && !baseIds.has(id) && inView.some((c) => c.id === id))
      .flatMap((id) => ofGender(data.live[id] ?? data.results[id]));
    const before = memoBefore(data, `${age}|${gender}|${date}`, () => computeRanking(base, data.comps, date, age, officialPlace));
    const after = computeRanking([...base, ...extra], data.comps, scenario.targetDate, age, officialPlace);
    const prefix = `${age}-${gender}`;
    const official = data.official.filter((o) => o.category.startsWith(prefix));
    for (const [cat, entries] of project(official, before, after)) if (cat.startsWith(prefix)) out.set(cat, entries);
  }
  return out;
}

// ---------- hook ----------

const readHash = () => parseHash(typeof location === 'undefined' ? '' : location.hash);

/**
 * The scenario hash state, synced with location.hash. `setHash` uses replaceState (toggles do not fill the
 * history); `pushHash` adds a history entry (opening an athlete: the back button returns to the table).
 */
export function useScenario(): {
  hash: ScenarioHash; setHash: (next: ScenarioHash) => void; pushHash: (next: ScenarioHash) => void;
} {
  const [hash, setState] = useState<ScenarioHash>(readHash);
  useEffect(() => {
    const onChange = () => setState(readHash());
    window.addEventListener('hashchange', onChange);
    window.addEventListener('popstate', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
      window.removeEventListener('popstate', onChange);
    };
  }, []);
  useEffect(() => {
    const h = formatHash(hash);
    if (location.hash !== h) history.replaceState(null, '', h);
  }, [hash]);
  const setHash = useCallback((next: ScenarioHash) => setState(next), []);
  const pushHash = useCallback((next: ScenarioHash) => {
    const h = formatHash(next);
    if (location.hash !== h) history.pushState({ pushed: true }, '', h);
    setState(next);
  }, []);
  return { hash, setHash, pushHash };
}
