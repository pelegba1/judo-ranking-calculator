import type { AgeGroup, AthleteResult, CompetitionMeta } from '../types';
import { isWeightOf } from './categories';

/**
 * The competition as it enters the `view` ranking, or null when it gives no points there.
 * Spec 5.1: each age group ranks its own events; a junior world championship also enters the senior ranking
 * as 'junior_world_ch' (Grand Prix values).
 */
export function competitionInView(meta: CompetitionMeta, view: AgeGroup): CompetitionMeta | null {
  if (meta.age === view) return meta;
  if (view === 'sen' && meta.age === 'jun' && meta.eventType === 'world_ch') {
    return { ...meta, age: 'sen', eventType: 'junior_world_ch' };
  }
  return null;
}

/**
 * Whether a result from an age group `from` competition has a category in the `view` ranking. A result carried
 * into another age group goes to the category with the same gender and weight label, and is dropped when that
 * age group has no such weight.
 */
export function resultHasViewCategory(r: AthleteResult, from: AgeGroup, view: AgeGroup): boolean {
  return from === view || isWeightOf(view, r.gender, r.weight);
}
