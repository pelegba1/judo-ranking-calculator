import { useDeferredValue, useMemo } from 'react';
import { useData, type MetaFile } from './useData';
import { AGES, buildProjection, resolveScenario, viewFiles, type ProjectionData } from './useScenario';
import { buildOlympicMemo, type OlympicRow, type OlympicView } from './olympic';
import type { AgeGroup, AthleteResult, CategoryKey, CompetitionMeta, Gender } from '../../engine/types';
import type { OfficialEntry, ProjectedEntry } from '../../engine/projection';

/** One category an athlete appears in, with the projected entry and (seniors) the Olympic row. */
export interface Where { age: AgeGroup; gender: Gender; weight: string; entry: ProjectedEntry; olympic?: OlympicRow }

export interface AllProjections {
  status: 'idle' | 'loading' | 'error' | 'ready';
  /** The inputs changed and the shown projections are from the previous ones. */
  stale: boolean;
  projections: Map<AgeGroup, Map<CategoryKey, ProjectedEntry[]>>;
  olympic: OlympicView | null;
}

/**
 * Every age group's projection for the scenario (the watch list and the search need an athlete's categories in
 * all of them). Heavy: the inputs go through useDeferredValue. `enabled` false = nothing is computed.
 */
export function useAllProjections({ enabled, meta, comps, live, added, date }: {
  enabled: boolean; meta: MetaFile; comps: Map<number, CompetitionMeta>; live: Record<string, AthleteResult[]>;
  added: number[]; date: string | null;
}): AllProjections {
  const data = useData();
  const files = AGES.map((a) => ({ official: data.official(a), results: data.results(a) }));
  const loadedAll = files.every((f) => f.official && f.results);
  const failed = AGES.some((a) => data.ageStatus(a) === 'error');
  const [o0, o1, o2] = files.map((f) => f.official);
  const [r0, r1, r2] = files.map((f) => f.results);
  // Olympic place/status of senior entries: optional (shown without it while it loads or if it fails)
  const olympicFile = data.olympicOfficial();
  const persons = data.persons;
  const input = useMemo(
    () => ({ go: loadedAll && enabled, o: [o0, o1, o2], r: [r0, r1, r2], meta, comps, live, added, date, olympicFile, persons }),
    [loadedAll, enabled, o0, o1, o2, r0, r1, r2, meta, comps, live, added, date, olympicFile, persons],
  );
  const deferred = useDeferredValue(input);
  const { projections, olympic } = useMemo(() => {
    const out = new Map<AgeGroup, Map<CategoryKey, ProjectedEntry[]>>();
    let olympic: OlympicView | null = null;
    if (!deferred.go) return { projections: out, olympic };
    const official: Record<AgeGroup, OfficialEntry[]> = { sen: deferred.o[0]!, jun: deferred.o[1]!, cad: deferred.o[2]! };
    const results: Record<AgeGroup, Record<string, AthleteResult[]>> = { sen: deferred.r[0]!, jun: deferred.r[1]!, cad: deferred.r[2]! };
    for (const age of AGES) {
      const pd: ProjectionData = {
        officialDates: deferred.meta.officialDates, comps: deferred.comps, live: deferred.live,
        // seniors also draw on junior world championships
        ...viewFiles(age, { official: official[age], results: results[age] }, { official: official.jun, results: results.jun }),
      };
      const scenario = resolveScenario({ age, gender: 'm', weight: '', added: deferred.added, date: deferred.date }, deferred.comps, deferred.meta.officialDates);
      out.set(age, buildProjection(pd, scenario));
      if (age === 'sen' && deferred.olympicFile && deferred.persons) {
        olympic = buildOlympicMemo(pd, deferred.olympicFile, deferred.persons, scenario); // shared with the Olympic screen
      }
    }
    return { projections: out, olympic };
  }, [deferred]);

  const status = !enabled ? 'idle' : failed ? 'error' : !loadedAll || projections.size === 0 ? 'loading' : 'ready';
  return { status, stale: deferred !== input, projections, olympic };
}

/** The categories of each wanted athlete (all of them when `wanted` is null), in age order. */
export function placesOf(all: AllProjections, wanted: ReadonlySet<number> | null): Map<number, Where[]> {
  const out = new Map<number, Where[]>();
  for (const [age, proj] of all.projections) {
    for (const [cat, entries] of proj) {
      const oly = age === 'sen' ? new Map(all.olympic?.byCategory.get(cat)?.map((r) => [r.idPerson, r])) : null;
      for (const entry of entries) {
        if (wanted && !wanted.has(entry.idPerson)) continue;
        const gender = cat[4] as Gender;
        const list = out.get(entry.idPerson) ?? [];
        const o = oly?.get(entry.idPerson);
        list.push({ age, gender, weight: cat.slice(5), entry, olympic: o });
        out.set(entry.idPerson, list);
      }
    }
  }
  return out;
}
