// IJF API id mapping for the official ranking (ranking.get_list): id_age / id_weight -> our age, gender, category.
import type { AgeGroup, CategoryKey, Gender } from '../engine/types';
import { WEIGHTS, categoryKey } from '../engine/rules/categories';

export type AgeGender = `${AgeGroup}-${Gender}`;
export const AGE_GENDERS: AgeGender[] = ['sen-m', 'sen-f', 'jun-m', 'jun-f', 'cad-m', 'cad-f'];

/** ranking.get_list id_age per age group and gender. */
export const ID_AGE: Record<AgeGender, number> = { 'sen-m': 1, 'sen-f': 2, 'jun-m': 7, 'jun-f': 8, 'cad-m': 9, 'cad-f': 10 };

/** First id_weight of each list; the following ids follow WEIGHTS[age][gender] in order. */
const FIRST_ID_WEIGHT: Record<AgeGender, number> = {
  'sen-m': 1, 'sen-f': 8, 'jun-m': 44, 'jun-f': 52, 'cad-m': 60, 'cad-f': 68,
};

const BY_ID_AGE = new Map(Object.entries(ID_AGE).map(([ag, id]) => [id, ag as AgeGender]));

export function splitAgeGender(ag: AgeGender): { age: AgeGroup; gender: Gender } {
  const [age, gender] = ag.split('-') as [AgeGroup, Gender];
  return { age, gender };
}

/** The category of an official ranking row, or null for an id pair we do not know. */
export function officialCategory(idAge: number | string, idWeight: number | string): CategoryKey | null {
  const ag = BY_ID_AGE.get(Number(idAge));
  if (!ag) return null;
  const { age, gender } = splitAgeGender(ag);
  const weight = WEIGHTS[age][gender][Number(idWeight) - FIRST_ID_WEIGHT[ag]];
  return weight ? categoryKey(age, { gender, weight }) : null;
}
