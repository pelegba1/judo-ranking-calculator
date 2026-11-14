// The last category table the user looked at, so "table" from the watch list returns there (this tab only).
import { WEIGHTS } from '../../engine/rules/categories';
import type { AgeGroup, Gender } from '../../engine/types';

export interface LastView { age: AgeGroup; gender: Gender; weight: string }
const KEY = 'lastView.v1';

export function saveLastView(v: LastView): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* unavailable: falls back to the default view */
  }
}

export function loadLastView(): LastView | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Partial<LastView> | null;
    if (!v || !(v.age! in WEIGHTS) || !(v.gender === 'm' || v.gender === 'f')) return null;
    const ok = WEIGHTS[v.age!][v.gender].includes(v.weight as string);
    return ok ? (v as LastView) : null;
  } catch {
    return null;
  }
}
