import { memo, type MouseEvent } from 'react';
import type { Person } from '../../engine/types';
import type { ProjectedEntry } from '../../engine/projection';
import { formatDelta, formatMovement, formatPoints, isAffected } from '../format';
import { S } from '../strings';

interface Props {
  entries: ProjectedEntry[];
  persons: Map<number, Person> | undefined;
  /** Ids of the competitions added to the scenario (rows touched by them are highlighted). */
  added: ReadonlySet<number>;
  hrefOf: (idPerson: number) => string;
  onOpen: (idPerson: number) => void;
}

/** The projected category: one tappable row per athlete. Rows are links, so open-in-new-tab and keyboard work. */
export function CategoryTable({ entries, persons, added, hrefOf, onOpen }: Props) {
  return (
    <div className="ctable" role="table" aria-label={S.tableTitle}>
      <div className="crow chead" role="row">
        <span role="columnheader">{S.colPlace}</span>
        <span role="columnheader">{S.colMove}</span>
        <span role="columnheader">{S.colName}</span>
        <span role="columnheader" className="c-country">{S.colCountry}</span>
        <span role="columnheader" className="c-points">{S.colPoints}</span>
      </div>
      {entries.map((e) => (
        <Row key={e.idPerson} e={e} person={persons?.get(e.idPerson)} hit={isAffected(e, added)} href={hrefOf(e.idPerson)} onOpen={onOpen} />
      ))}
    </div>
  );
}

const Row = memo(function Row({ e, person, hit, href, onOpen }: {
  e: ProjectedEntry; person: Person | undefined; hit: boolean; href: string; onOpen: (id: number) => void;
}) {
  const move = formatMovement(e.officialPlace, e.projectedPlace);
  const name = person?.name ?? S.athleteUnknown(e.idPerson);
  const click = (ev: MouseEvent) => {
    if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    ev.preventDefault();
    onOpen(e.idPerson);
  };
  return (
    <a
      className={`crow${hit ? ' is-hit' : ''}`} role="row" href={href} onClick={click}
      aria-label={S.openAthlete(name)}
    >
      <span role="cell" className="c-place"><bdi dir="ltr">{e.projectedPlace}</bdi></span>
      <span role="cell" className={`c-move move-${move.dir}`} title={S.officialWas(e.officialPlace)}><bdi dir="ltr">{move.label}</bdi></span>
      <span role="cell" className="c-name">
        <span className="c-name-text">{name}</span>
        {!e.verified && <span className="tag tag-warn">{S.notVerified}</span>}
      </span>
      <span role="cell" className="c-country"><bdi dir="ltr">{person?.country ?? ''}</bdi></span>
      <span role="cell" className="c-points">
        <bdi dir="ltr">{formatPoints(e.projectedPoints)}</bdi>
        {e.delta !== 0 && <bdi dir="ltr" className={`delta ${e.delta > 0 ? 'up' : 'down'}`}>{formatDelta(e.delta)}</bdi>}
      </span>
    </a>
  );
});
