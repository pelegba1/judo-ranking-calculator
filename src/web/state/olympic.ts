// The projected LA28 Olympic ranking and quota statuses for a scenario. Same principle as the world ranking table:
// projected Olympic points = official Olympic points + (engine after - engine before); the allocation runs on the
// projected points. Pure logic (memoised); the screens call it from deferred inputs.
import { allocateQuotas, completeOfficial, olympicPoints, statusIn, type OlympicStatus, type QuotaEntry } from '../../engine/olympic';
import { project, type OfficialEntry, type ProjectedEntry } from '../../engine/projection';
import type { RankingEntry } from '../../engine/ranking';
import { CONTINENTAL_QUOTA, CONTINENTS, continentOf, type Continent } from '../../engine/rules/la28';
import type { OfficialPlace } from '../../engine/rules/domestic';
import type { AthleteResult, CategoryKey, Gender, Person } from '../../engine/types';
import type { OfficialOlympicStatus, OlympicOfficialFile } from '../../pipeline/olympic';
import { GENDERS, appliesTo, type ProjectionData, type Scenario } from './useScenario';

export interface OlympicRow extends ProjectedEntry {
  status: OlympicStatus;
  /** q_status of the official list (null: athlete not asked by the nightly run). */
  officialStatus: OfficialOlympicStatus | null;
}
export interface ContinentalSummary {
  continent: Continent;
  quota: Record<Gender, number>;
  /** Athletes of this continent with a continental place (incl. ones reallocated from other continents). */
  qualified: Record<Gender, OlympicRow[]>;
}
export interface OlympicView {
  /** Date of the official Olympic list the projection starts from. */
  officialDate: string;
  byCategory: Map<CategoryKey, OlympicRow[]>;
  byPerson: Map<number, OlympicRow>;
  continental: ContinentalSummary[];
  /** Athletes without a known continent and without a place (left out of the continental lists), per gender. */
  noContinent: Record<Gender, number>;
}

function officialPlaceLookup(official: OfficialEntry[]): OfficialPlace {
  const m = new Map(official.map((o) => [`${o.idPerson}|${o.category}`, o.place]));
  return (id, cat) => m.get(`${id}|${cat}`);
}

const maxDate = (a: string, b: string) => (a > b ? a : b);

// `before` depends on the nightly results, the WRL official list (domestic rule), the Olympic date and gender.
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
 * The Olympic view of a senior scenario. Per gender: `before` = the Olympic engine on the official Olympic date over
 * the competitions that ended before it; `after` = the competitions included in the official world ranking (or the
 * Olympic list, whichever is later) plus the added ones, on the target date. Athletes the official file does not
 * cover (the nightly run did not ask about them) take the engine's `before` total as their official one and are
 * unverified.
 */
export function buildOlympic(
  data: ProjectionData, officialFile: OlympicOfficialFile, persons: ReadonlyMap<number, Person>, scenario: Scenario,
): OlympicView {
  const wrlDate = (g: Gender) => data.officialDates[`sen-${g}`];
  const officialDate = officialFile.date ?? maxDate(wrlDate('m'), wrlDate('f'));
  const officialPlace = officialPlaceLookup(data.official);
  const inView = [...data.comps.values()].filter((c) => appliesTo(c, 'sen'));
  const asked = new Set(officialFile.entries.map((e) => e.idPerson));
  const statusOf = new Map(officialFile.entries.map((e) => [`${e.idPerson}|${e.category}`, e.status] as const));

  const projected = new Map<CategoryKey, ProjectedEntry[]>();
  for (const gender of GENDERS) {
    const ofGender = (rs: AthleteResult[] | undefined) => (rs ?? []).filter((r) => r.gender === gender);
    const cutoff = maxDate(officialDate, wrlDate(gender));
    const beforeIds = inView.filter((c) => c.dateTo < officialDate).map((c) => c.id);
    const baseIds = new Set(inView.filter((c) => c.dateTo < cutoff).map((c) => c.id));
    const before = memoBefore(data, `olympic|${gender}|${officialDate}`,
      () => olympicPoints(beforeIds.flatMap((id) => ofGender(data.results[id])), data.comps, officialDate, officialPlace));
    const extra = scenario.added
      .filter((id, i, a) => a.indexOf(id) === i && !baseIds.has(id) && inView.some((c) => c.id === id))
      .flatMap((id) => ofGender(data.live[id] ?? data.results[id]));
    const after = olympicPoints([...[...baseIds].flatMap((id) => ofGender(data.results[id])), ...extra], data.comps, scenario.targetDate, officialPlace);
    const prefix = `sen-${gender}`;
    const own = officialFile.entries.filter((e) => e.category.startsWith(prefix)).map((e) => ({ ...e, place: e.place ?? 0 }));
    const official = completeOfficial(own, before);
    for (const [cat, entries] of project(official, before, after)) {
      if (!cat.startsWith(prefix)) continue;
      const kept = entries.filter((e) => e.projectedPoints > 0);
      for (const e of kept) if (!asked.has(e.idPerson)) e.verified = false; // never checked against the IJF
      projected.set(cat, kept);
    }
  }

  const ranking = new Map<CategoryKey, QuotaEntry[]>();
  for (const [cat, list] of projected) {
    ranking.set(cat, list.map((p) => ({ idPerson: p.idPerson, category: cat, points: p.projectedPoints, place: p.projectedPlace, results: p.engine?.results })));
  }
  const statuses = allocateQuotas(ranking, persons);

  const byCategory = new Map<CategoryKey, OlympicRow[]>();
  const byPerson = new Map<number, OlympicRow>();
  for (const [cat, list] of projected) {
    const rows = list.map((p): OlympicRow => ({
      ...p, status: statusIn(statuses, p.idPerson, cat, p.projectedPlace),
      officialStatus: statusOf.get(`${p.idPerson}|${cat}`) ?? null,
    }));
    byCategory.set(cat, rows);
    for (const r of rows) if (!byPerson.has(r.idPerson) || r.status.kind !== 'out') byPerson.set(r.idPerson, r);
  }

  const noContinent: Record<Gender, number> = { m: 0, f: 0 };
  const continental: ContinentalSummary[] = CONTINENTS.map((continent) => ({
    continent, quota: CONTINENTAL_QUOTA[continent], qualified: { m: [], f: [] },
  }));
  for (const [cat, rows] of byCategory) {
    const g = cat[4] as Gender;
    for (const r of rows) {
      const p = persons.get(r.idPerson);
      const c = continentOf(p?.continent);
      if (!c) {
        if (r.status.kind === 'out') noContinent[g]++; // a continental candidate the lists cannot place
        continue;
      }
      if (r.status.kind === 'continental') continental.find((x) => x.continent === c)!.qualified[g].push(r);
    }
  }
  for (const s of continental) for (const g of GENDERS) s.qualified[g].sort((a, b) => b.projectedPoints - a.projectedPoints || a.idPerson - b.idPerson);
  return { officialDate, byCategory, byPerson, continental, noContinent };
}

// One computation per scenario, shared by the Olympic screen and the watch list.
let last: { args: unknown[]; view: OlympicView } | null = null;
export function buildOlympicMemo(
  data: ProjectionData, officialFile: OlympicOfficialFile, persons: ReadonlyMap<number, Person>, scenario: Scenario,
): OlympicView {
  const args = [data.results, data.official, data.comps, data.live, data.officialDates, officialFile, persons,
    scenario.added.join(','), scenario.targetDate];
  if (last && last.args.length === args.length && last.args.every((a, i) => a === args[i])) return last.view;
  const view = buildOlympic(data, officialFile, persons, scenario);
  last = { args, view };
  return view;
}
