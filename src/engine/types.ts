export type AgeGroup = 'sen' | 'jun' | 'cad';
export type Gender = 'm' | 'f';
export type EventType = 'continental_cup' | 'continental_open' | 'continental_ch' | 'grand_prix'
  | 'grand_slam' | 'masters' | 'world_ch' | 'olympic_games' | 'junior_world_ch';
export type Place = 1 | 2 | 3 | 5 | 7 | 9 | 17 | 33 | 65 | 129;
export interface CompetitionMeta {
  id: number; code: string; name: string; dateFrom: string; dateTo: string;
  age: AgeGroup; eventType: EventType; hostCountry: string; // IOC code, e.g. 'UAE'
}
export interface AthleteResult {
  competitionId: number; idPerson: number; gender: Gender; weight: string; // '-60'
  place: Place; wins: number; country: string; categoryFinished: boolean;
}
export interface Person { id: number; name: string; country: string; continent: string; }
export type CategoryKey = `${AgeGroup}-${Gender}${string}`; // 'sen-m-60', 'cad-f+70'
