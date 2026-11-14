import { Fragment, useDeferredValue, useMemo } from 'react';
import type { CategoryKey, Gender, Person } from '../../engine/types';
import type { OlympicStatusKind } from '../../engine/olympic';
import type { OlympicOfficialFile } from '../../pipeline/olympic';
import { buildOlympicMemo, type OlympicRow, type OlympicView } from '../state/olympic';
import { formatHash, type ProjectionData, type Scenario, type ScenarioHash } from '../state/useScenario';
import { formatDelta, formatMovement, formatPoints } from '../format';
import { CONTINENT_LABEL, GENDER_LABEL, S, STATUS_LABEL } from '../strings';
import { HOST, continentOf } from '../../engine/rules/la28';

interface Props {
  data: ProjectionData;
  scenario: Scenario;
  hash: ScenarioHash;
  officialFile: OlympicOfficialFile;
  persons: Map<number, Person>;
}

/** The projected Olympic ranking of one senior category with quota statuses, and the continental places. */
export function Olympic({ data, scenario, hash, officialFile, persons }: Props) {
  const key = `${scenario.added.join(',')}|${scenario.targetDate}`;
  // gender/weight changes reuse the computation (it covers every category)
  const input = useMemo(() => ({ data, scenario, officialFile, persons, key }), [data, officialFile, persons, key]);
  const deferred = useDeferredValue(input);
  const view = useMemo(
    () => buildOlympicMemo(deferred.data, deferred.officialFile, deferred.persons, deferred.scenario),
    [deferred],
  );
  const stale = deferred !== input;
  const cat = `sen-${scenario.gender}${scenario.weight}` as CategoryKey;
  const rows = view.byCategory.get(cat) ?? [];

  return (
    <div className={stale ? 'is-stale' : undefined} aria-busy={stale}>
      <p className="muted small">{S.olympicIntro}</p>
      <p className="muted small">{S.olympicOfficialDate(view.officialDate)}</p>
      {rows.length === 0 ? (
        <p className="muted">{S.olympicNoEntries}</p>
      ) : (
        <OlympicTable rows={rows} persons={persons} hash={hash} />
      )}
      <Continental view={view} gender={scenario.gender} persons={persons} />
    </div>
  );
}

function StatusChip({ kind }: { kind: OlympicStatusKind }) {
  return <span className={`ochip ochip-${kind}`}>{STATUS_LABEL[kind]}</span>;
}

function OlympicTable({ rows, persons, hash }: { rows: OlympicRow[]; persons: Map<number, Person>; hash: ScenarioHash }) {
  const lastDirect = rows.reduce((last, r, i) => (r.status.kind === 'direct' ? i : last), -1);
  const { olympic: _o, ...rest } = hash;
  return (
    <div className="otable" role="table" aria-label={S.olympicTitle}>
      <div className="orow ohead" role="row">
        <span role="columnheader">{S.colPlace}</span>
        <span role="columnheader">{S.colName}</span>
        <span role="columnheader" className="c-points">{S.colPoints}</span>
      </div>
      {rows.map((r, i) => {
        const person = persons.get(r.idPerson);
        const move = formatMovement(r.officialPlace, r.projectedPlace);
        const official = r.officialStatus;
        const href = formatHash({ ...rest, age: 'sen', athlete: r.idPerson });
        return (
          <Fragment key={r.idPerson}>
            <a className={`orow ostatus-${r.status.kind}`} role="row" href={href}>
              <span className="c-place" role="cell">
                <bdi dir="ltr">{r.projectedPlace}</bdi>
                <span className={`c-move move-${move.dir}`} title={S.officialWas(r.officialPlace)}><bdi dir="ltr">{move.label}</bdi></span>
              </span>
              <span className="c-name" role="cell">
                <span className="c-name-text">{person?.name ?? S.athleteUnknown(r.idPerson)}</span>
                <span className="o-meta">
                  <bdi dir="ltr" className="muted small">{person?.country ?? ''}</bdi>
                  <StatusChip kind={r.status.kind} />
                  {!r.verified && <span className="tag tag-warn">{S.notVerified}</span>}
                  {person && person.country !== HOST && !continentOf(person.continent) && <span className="tag">{S.continentUnknownTag}</span>}
                </span>
                {official && official !== r.status.kind && (
                  <span className="muted small">{S.officialStatus(STATUS_LABEL[official])}</span>
                )}
              </span>
              <span className="c-points" role="cell">
                <bdi dir="ltr">{formatPoints(r.projectedPoints)}</bdi>
                {r.delta !== 0 && <bdi dir="ltr" className={`delta ${r.delta > 0 ? 'up' : 'down'}`}>{formatDelta(r.delta)}</bdi>}
              </span>
            </a>
            {i === lastDirect && i < rows.length - 1 && <div className="oline" role="separator">{S.directLine}</div>}
          </Fragment>
        );
      })}
    </div>
  );
}

function Continental({ view, gender, persons }: { view: OlympicView; gender: Gender; persons: Map<number, Person> }) {
  return (
    <section className="continental" aria-labelledby="continental-title">
      <h3 id="continental-title">{S.continentalTitle}</h3>
      <p className="muted small">{S.continentalFor(GENDER_LABEL[gender])}</p>
      {view.continental.map((c) => {
        const list = c.qualified[gender];
        return (
          <div key={c.continent} className="cont-block">
            <div className="cont-head">
              <strong>{CONTINENT_LABEL[c.continent]}</strong>
              <span className="muted small">{S.continentalCount(list.length, c.quota[gender])}</span>
            </div>
            {list.length === 0 ? (
              <p className="muted small">{S.continentalNone}</p>
            ) : (
              <ol className="cont-list">
                {list.map((r) => {
                  const p = persons.get(r.idPerson);
                  return (
                    <li key={r.idPerson}>
                      <span className="cont-name">{p?.name ?? S.athleteUnknown(r.idPerson)}</span>
                      <span className="muted small">
                        <bdi dir="ltr">{p?.country ?? ''}</bdi> · <bdi dir="ltr">{r.category.slice(5)}</bdi>
                      </span>
                      <bdi dir="ltr" className="cont-points">{formatPoints(r.projectedPoints)}</bdi>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        );
      })}
      <p className="footnote">{S.continentalReallocated}</p>
      {view.noContinent[gender] > 0 && <p className="footnote">{S.noContinent(view.noContinent[gender])}</p>}
    </section>
  );
}

