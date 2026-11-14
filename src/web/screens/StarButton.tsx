import { S } from '../strings';

/** The watch-list star: its own 44px tap target, never nested inside a link. */
export function StarButton({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  const label = on ? S.starRemove : S.starAdd;
  return (
    <button type="button" className={`star${on ? ' is-on' : ''}`} aria-pressed={on} aria-label={label} title={label} onClick={onToggle}>
      <span aria-hidden="true">{on ? '★' : '☆'}</span>
    </button>
  );
}
