import type { AgeGroup, CategoryKey, Gender } from '../types';

const SENIOR: Record<Gender, string[]> = {
  m: ['-60', '-66', '-73', '-81', '-90', '-100', '+100'],
  f: ['-48', '-52', '-57', '-63', '-70', '-78', '+78'],
};

/** Official weight categories per age group and gender. Juniors use the senior weights. */
export const WEIGHTS: Record<AgeGroup, Record<Gender, string[]>> = {
  sen: SENIOR,
  jun: SENIOR,
  cad: {
    m: ['-50', '-55', '-60', '-66', '-73', '-81', '-90', '+90'],
    f: ['-40', '-44', '-48', '-52', '-57', '-63', '-70', '+70'],
  },
};

export function isWeightOf(age: AgeGroup, gender: Gender, weight: string): boolean {
  return WEIGHTS[age][gender].includes(weight);
}

export function categoryKey(age: AgeGroup, r: { gender: Gender; weight: string }): CategoryKey {
  return `${age}-${r.gender}${r.weight}`;
}
