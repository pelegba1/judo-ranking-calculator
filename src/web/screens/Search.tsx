import { useDeferredValue, useMemo } from 'react';
import { useData } from '../state/useData';
import { AGES, type ScenarioHash } from '../state/useScenario';
import type { Watchlist } from '../state/watchlist';
import { placesOf, useAllProjections, type Where } from '../state/useAllProjections';
import { countriesOf, matchesName, searchable } from '../search';
import { AGE_LABEL, S } from '../strings';
import { AthleteRows } from './AthleteRows';
import { CountryFilter } from './CountryFilter';
import type { AgeGroup, AthleteResult, CompetitionMeta } from '../../engine/types';
import type { MetaFile } from '../state/useData';

/** Most athletes listed at once; a wider search asks to narrow it. */
const LIMIT = 100;

interface Props {
  meta: MetaFile;
  comps: Map<number, CompetitionMeta>;
  hash: ScenarioHash;
  setHash: (h: ScenarioHash) => void;
  watchlist: Watchlist;
  live: Record<string, AthleteResult[]>;
}

const bestPlace = (w: Where[]) => Math.min(...w.map((x) => x.entry.projectedPlace));

/** Find athletes by name and/or country, across every age group and category, with their projected places. */
export function Search({ meta, comps, hash, setHash, watchlist, live }: Props) {
  const data = useData();
  const persons = data.persons;
  const q = hash.q ?? '';
  const country = hash.country;
  const byName = searchable(q);
  const active = byName || !!country;

  const all = useAllProjections({ enabled: true, meta, comps, live, added: hash.added, date: hash.date });
  const index = useMemo(() => placesOf(all, null), [all.projections, all.olympic]);
  const countries = useMemo(() => countriesOf(index.keys(), persons, country), [index, persons, country]);

  const searchAge = hash.searchAge;
  const deferredQ = useDeferredValue(q);
  const found = useMemo(() => {
    if (!persons || !(searchable(deferredQ) || country)) return [];
    const out: { id: number; where: Where[]; best: number }[] = [];
    for (const [id, all] of index) {
      const p = persons.get(id);
      if (!p) continue;
      if (country && p.country !== country) continue;
      if (searchable(deferredQ) && !matchesName(p.name, deferredQ)) continue;
      const where = searchAge ? all.filter((w) => w.age === searchAge) : all;
      if (!where.length) continue;
      out.push({ id, where, best: bestPlace(where) });
    }
    out.sort((a, b) => a.best - b.best || persons.get(a.id)!.name.localeCompare(persons.get(b.id)!.name));
    return out;
  }, [index, persons, deferredQ, country, searchAge]);

  const set = (next: Partial<ScenarioHash>) => setHash({ ...hash, ...next });

  return (
    <div>
      <div className="search-bar">
        <label className="sr-only" htmlFor="search-q">{S.searchLabel}</label>
        <input
          id="search-q" type="search" dir="auto" autoComplete="off" spellCheck={false} autoFocus={!q}
          placeholder={S.searchPlaceholder} value={q} maxLength={100}
          onChange={(e) => set({ q: e.target.value || undefined })}
        />
        <CountryFilter id="search-country" value={country} options={countries} onChange={(c) => set({ country: c })} />
        <fieldset className="segmented">
          <legend>{S.ageLegend}</legend>
          <div className="seg-row">
            {([undefined, ...AGES] as (AgeGroup | undefined)[]).map((a) => (
              <label key={a ?? 'all'} className={`seg${a === searchAge ? ' is-on' : ''}`}>
                <input type="radio" name="search-age" checked={a === searchAge} onChange={() => set({ searchAge: a })} />
                {a ? AGE_LABEL[a] : S.searchAllAges}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      {!active ? (
        <p className="muted">{q.trim() ? S.searchTooShort : S.searchHint}</p>
      ) : all.status === 'error' || data.personsStatus === 'error' ? (
        <div className="state state-error" role="alert"><p>{S.loadError}</p></div>
      ) : all.status !== 'ready' || !persons ? (
        <p className="state">{S.ageLoading}</p>
      ) : found.length === 0 ? (
        <p className="muted">{S.searchNone}</p>
      ) : (
        <div className={all.stale || deferredQ !== q ? 'is-stale' : undefined} aria-busy={all.stale}>
          <p className="muted small" role="status">
            {found.length > LIMIT ? S.searchMore(LIMIT, found.length) : S.searchCount(found.length)}
          </p>
          <ul className="watch-list">
            {found.slice(0, LIMIT).map((r) => (
              <AthleteRows
                key={r.id} id={r.id} person={persons.get(r.id)} where={r.where} hash={hash}
                starred={watchlist.set.has(r.id)} onToggleStar={watchlist.toggle}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
