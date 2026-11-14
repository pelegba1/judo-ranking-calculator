import { memo, type MouseEvent, type ReactNode } from 'react';
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
  /** Must be referentially stable (Row is memoised). */
  onOpen: (idPerson: number) => void;
  /** Slot for the watch-list star (Task 11); rendered inside each row. */
  renderStar?: (idPerson: number) => ReactNode;
}

/** The projected category: one tappable row per athlete. Rows are links, so open-in-new-tab and keyboard work. */
export function CategoryTable({ entries, persons, added, hrefOf, onOpen, renderStar }: Props) {
  return (
    <div className="ctable">
      <div className="crow chead">
        <span>{S.colPlace}</span>
        <span>{S.colMove}</span>
        <span>{S.colName}</span>
        <span className="c-country">{S.colCountry}</span>
        <span className="c-points">{S.colPoints}</span>
      </div>
      {entries.map((e) => (
        <Row key={e.idPerson} e={e} person={persons?.get(e.idPerson)} hit={isAffected(e, added)} href={hrefOf(e.idPerson)} onOpen={onOpen} star={renderStar?.(e.idPerson)} />
      ))}
    </div>
  );
}

const Row = memo(function Row({ e, person, hit, href, onOpen, star }: {
  e: ProjectedEntry; person: Person | undefined; hit: boolean; href: string; onOpen: (id: number) => void; star: ReactNode;
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
      className={`crow${hit ? ' is-hit' : ''}`} href={href} onClick={click}>
      <span className="c-place"><bdi dir="ltr">{e.projectedPlace}</bdi></span>
      <span className={`c-move move-${move.dir}`} title={S.officialWas(e.officialPlace)}><bdi dir="ltr">{move.label}</bdi></span>
      <span className="c-name">
        <span className="c-name-text">{name}</span>
        {!e.verified && <span className="tag tag-warn">{S.notVerified}</span>}
        {star}
      </span>
      <span className="c-country"><bdi dir="ltr">{person?.country ?? ''}</bdi></span>
      <span className="c-points">
        <bdi dir="ltr">{formatPoints(e.projectedPoints)}</bdi>
        {e.delta !== 0 && <bdi dir="ltr" className={`delta ${e.delta > 0 ? 'up' : 'down'}`}>{formatDelta(e.delta)}</bdi>}
      </span>
    </a>
  );
});
