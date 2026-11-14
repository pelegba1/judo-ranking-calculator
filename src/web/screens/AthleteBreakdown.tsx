import type { AgeGroup, Gender, Person } from '../../engine/types';
import type { ProjectedEntry } from '../../engine/projection';
import type { ScoredResult } from '../../engine/scoring';
import type { Period } from '../../engine/rules/decay';
import { formatDate, formatDelta, formatMovement, formatPoints, placeLabel } from '../format';
import { AGE_LABEL, GENDER_LABEL, S } from '../strings';

interface Props {
  entry: ProjectedEntry | undefined;
  idPerson: number;
  person: Person | undefined;
  age: AgeGroup;
  weight: string;
  gender: Gender;
  added: ReadonlySet<number>;
  onBack: () => void;
}

type Group = { title: string; rows: ScoredResult[] };

const BEST = ['grand_prix', 'continental_cup'];
const byValue = (a: ScoredResult, b: ScoredResult) =>
  b.value - a.value || b.base - a.base || (a.meta.dateFrom < b.meta.dateFrom ? 1 : -1);

/** Results of one period split into the sections of the ranking rules. Seniors: one list (counted first). */
function groupsOf(age: AgeGroup, rows: ScoredResult[]): Group[] {
  const counted = rows.filter((r) => r.counted).sort(byValue);
  const rest = rows.filter((r) => !r.counted).sort(byValue);
  if (age === 'sen') return [{ title: '', rows: [...counted, ...rest] }];
  const best = counted.filter((r) => BEST.includes(r.meta.eventType));
  const cont = counted.filter((r) => r.meta.eventType === 'continental_ch');
  const world = counted.filter((r) => r.meta.eventType === 'world_ch' || r.meta.eventType === 'junior_world_ch');
  const other = counted.filter((r) => !best.includes(r) && !cont.includes(r) && !world.includes(r));
  return [
    { title: S.grpBest, rows: best }, { title: S.grpContinental, rows: cont }, { title: S.grpWorld, rows: world },
    { title: S.grpOther, rows: other }, { title: S.grpNotCounted, rows: rest },
  ].filter((g) => g.rows.length > 0);
}

export function AthleteBreakdown({ entry, idPerson, person, age, weight, gender, added, onBack }: Props) {
  const name = person?.name ?? S.athleteUnknown(idPerson);
  const back = <button type="button" className="btn btn-small back" onClick={onBack}>{S.back}</button>;
  if (!entry) {
    return (
      <div>
        {back}
        <h2 className="ath-name">{name}</h2>
        <p className="muted">{S.athleteNotFound}</p>
      </div>
    );
  }
  const move = formatMovement(entry.officialPlace, entry.projectedPlace);
  const results = entry.engine?.results ?? [];
  const by = (p: Period) => results.filter((r) => r.period === p);
  const engineTotal = entry.engine?.points;

  return (
    <div className="breakdown">
      {back}
      <header className="ath-head">
        <h2 className="ath-name">{name}</h2>
        <p className="muted small">
          <bdi dir="ltr">{person?.country ?? ''}</bdi> · {AGE_LABEL[age]} · {GENDER_LABEL[gender]} · <bdi dir="ltr">{weight}</bdi> {S.kg}
        </p>
        <dl className="stats">
          <div>
            <dt>{S.projectedPlace}</dt>
            <dd>
              <bdi dir="ltr">{entry.projectedPlace}</bdi>{' '}
              <span className={`move-${move.dir}`}>{move.label}</span>
            </dd>
          </div>
          <div><dt>{S.projectedPoints}</dt><dd><bdi dir="ltr">{formatPoints(entry.projectedPoints)}</bdi></dd></div>
          <div>
            <dt>{S.officialPoints}</dt>
            <dd>
              <bdi dir="ltr">{formatPoints(entry.officialPoints)}</bdi>
              {entry.officialPlace !== null && <span className="muted small"> · {S.officialWas(entry.officialPlace)}</span>}
            </dd>
          </div>
          <div>
            <dt>{S.deltaLabel}</dt>
            <dd>
              {entry.delta === 0
                ? <span className="muted">—</span>
                : <bdi dir="ltr" className={entry.delta > 0 ? 'up' : 'down'}>{formatDelta(entry.delta)}</bdi>}
            </dd>
          </div>
        </dl>
        {!entry.verified && (
          <p className="unverified">
            <span className="tag tag-warn">{S.notVerified}</span> {S.notVerifiedWhy}
            {engineTotal !== undefined && <> <span className="small">{S.engineTotal(formatPoints(engineTotal))}</span></>}
          </p>
        )}
      </header>

      {!entry.engine ? (
        <p className="notice notice-warn">{S.noBreakdown}</p>
      ) : (
        <>
          <Section title={S.secCurrent} age={age} rows={by('current')} added={added} period="current" />
          <Section title={S.secPrevious} age={age} rows={by('previous')} added={added} period="previous" />
          {by('expired').length > 0 && (
            <details className="sec sec-expired">
              <summary>{S.secExpired} ({by('expired').length})</summary>
              <ResultList rows={[...by('expired')].sort(byValue)} added={added} period="expired" />
            </details>
          )}
        </>
      )}
    </div>
  );
}

function Section({ title, age, rows, added, period }: {
  title: string; age: AgeGroup; rows: ScoredResult[]; added: ReadonlySet<number>; period: Period;
}) {
  return (
    <section className="sec">
      <h3>{title}</h3>
      {rows.length === 0 && <p className="muted small">{S.noResultsInSection}</p>}
      {groupsOf(age, rows).map((g, i) => (
        <div key={g.title || i} className="grp">
          {g.title && <h4>{g.title}</h4>}
          <ResultList rows={g.rows} added={added} period={period} />
        </div>
      ))}
    </section>
  );
}

function ResultList({ rows, added, period }: { rows: ScoredResult[]; added: ReadonlySet<number>; period: Period }) {
  return (
    <ul className="results">
      {rows.map((r) => {
        const isNew = added.has(r.result.competitionId);
        return (
          <li key={`${r.result.competitionId}-${r.result.weight}`} className={`res${r.counted ? '' : ' not-counted'}${isNew ? ' is-new' : ''}`}>
            <div className="res-main">
              <span className="res-name">{r.meta.name}</span>
              <span className="res-pts">
                <bdi dir="ltr">{formatPoints(r.value)}</bdi>
                {period === 'previous' && <span className="res-base small muted">{S.fromBase(formatPoints(r.base))}</span>}
              </span>
            </div>
            <div className="res-meta small">
              <bdi dir="ltr">{formatDate(r.meta.dateTo)}</bdi>
              <span>{S.placeShort} <bdi dir="ltr">{placeLabel(r.result.place)}</bdi></span>
              <span className={r.counted ? 'tag tag-ok' : 'tag'}>{r.counted ? S.counted : S.notCounted}</span>
              {isNew && <span className="tag tag-new">{S.isNew}</span>}
              {period === 'current' && <span className="muted">{S.dropsTo50}<bdi dir="ltr">{formatDate(r.halfDate)}</bdi></span>}
              {period === 'previous' && <span className="muted">{S.expiresOn}<bdi dir="ltr">{formatDate(r.expireDate)}</bdi></span>}
              {period === 'expired' && <span className="muted">{S.expiresOn}<bdi dir="ltr">{formatDate(r.expireDate)}</bdi></span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
