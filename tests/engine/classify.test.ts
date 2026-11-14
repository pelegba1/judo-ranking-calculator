import { describe, it, expect } from 'vitest';
import { classifyCompetition } from '../../src/engine/rules/classify';

const c = (code: string) => classifyCompetition(code, '');
describe('classifyCompetition', () => {
  it.each([
    ['gs_uae2026', 'sen', 'grand_slam'],
    ['gp_cro2026', 'sen', 'grand_prix'],
    ['masters_2026', 'sen', 'masters'],
    ['wc_sen2026', 'sen', 'world_ch'],
    ['cont_open_ita2026', 'sen', 'continental_open'],
    ['eju_sen2025', 'sen', 'continental_ch'],
    ['aju_sen2026', 'sen', 'continental_ch'],
    ['jua_sen2025', 'sen', 'continental_ch'],
    ['oju_sen2026', 'sen', 'continental_ch'],
    ['pjc_oju_sen2025', 'sen', 'continental_ch'],
    ['pjc_sen2026', 'sen', 'continental_ch'],
    ['cont_cup_cad_aze2026', 'cad', 'continental_cup'],
    ['eju_cad2026', 'cad', 'continental_ch'],
    ['oju_cad2026', 'cad', 'continental_ch'],
    ['wc_jun2025', 'jun', 'world_ch'],
    ['wc_cad2025', 'cad', 'world_ch'],
    ['gp_jun_ger2026', 'jun', 'grand_prix'],
    ['gp_cad_ger2026', 'cad', 'grand_prix'],
    ['cont_cup_jun_pol2026', 'jun', 'continental_cup'],
    ['oly2028', 'sen', 'olympic_games'],
  ])('%s', (code, age, eventType) => {
    expect(c(code)).toEqual({ age, eventType });
  });
  it.each(['cont_cup_sen_esp2026', 'itc_jpn2026', 'jua_games2026', 'sea_tha2025', 'sag_arg2026',
    'cg_gbr2026', 'eju_ss2025', 'kata_esp2026', 'eju_nw_lat2026', 'wcup_ibsa_geo2025', 'pjc_cag2025'])(
    'null for %s', (code) => expect(c(code)).toBeNull());
});
