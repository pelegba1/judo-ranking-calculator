# Judo Ranking Calculator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A phone-friendly static site that projects the IJF World Ranking (seniors, juniors, cadets) and the LA28 Olympic ranking after competitions that the official list has not absorbed yet, entered as JudoTV links.

**Architecture:** A pure TypeScript engine (`src/engine`) turns per-competition athlete results into rankings using the SOR 2026 rules. A Node pipeline (`src/pipeline`), run nightly by GitHub Actions, pulls 26 months of results from `data.ijf.org` into static JSON, and validates the engine against the official totals. A React site (`src/web`) on GitHub Pages loads that JSON, fetches a newly entered competition live from the same API (CORS is `*`), and shows official points + engine delta.

**Tech Stack:** Node 24, TypeScript 5, Vite 6, React 18, Vitest 2, GitHub Actions, GitHub Pages. No Python on this machine.

**Spec:** `docs/superpowers/specs/2026-11-14-judo-ranking-calculator-design.md` (read it first — rules tables in §5.1, LA28 rules in §5.2, API table in §5.3).

## Global Constraints

- All work inside `C:\Users\agamb\Projects\judo-ranking-calculator`. Never touch other folders.
- UI language Hebrew, `dir="rtl"`, phone-first layout (works at 360px width); no login anywhere.
- API base: `https://data.ijf.org/api/get_json` with `params[action]=…`; always pass `params[limit]` (≥5000 for lists, 20000 for `ranking.get_list`). Curl needs `-g` because of the brackets.
- Unit tests never hit the network; they read recorded fixtures under `tests/fixtures/`.
- Displayed points = official total + engine delta (spec §7.3). An athlete whose engine total for the official date ≠ official total is flagged "לא מאומת".
- Rules live only in `src/engine/rules/` (points tables, counting rules, event classification). No rule constants elsewhere.
- PDF input is out of scope (v2). Mixed teams, nations ranking, kata, universality/invitation places: out of scope.
- `git push`, creating the GitHub repo and enabling Pages need the user's explicit OK (Task 8).

## Facts pinned from the live API (14.11.2026)

- Official ranking ids: `id_age` 1 = senior men, 2 = senior women, 7 = junior men, 8 = junior women, 9 = cadet men, 10 = cadet women.
- `id_weight`: senior men 1–7 = -60,-66,-73,-81,-90,-100,+100; senior women 8–14 = -48,-52,-57,-63,-70,-78,+78; cadet men 60–67 = -50,-55,-60,-66,-73,-81,-90,+90; cadet women 68–75 = -40,-44,-48,-52,-57,-63,-70,+70; junior men 44–50 and junior women 52–58 assumed same labels as seniors (confirm from a junior fixture in Task 3).
- `competition.get_list` returns only senior events (≈100/year). Junior/cadet events exist and have full data (e.g. id 3191 `cont_cup_cad_aze2026`) but must be discovered by scanning ids with `competition.info` (ids are sequential, future events already have ids: 3310 = 21.11.2026).
- `contest.find&params[id_competition]=X&params[limit]=5000` returns all bouts; fields used: `id_person_white/blue`, `id_winner`, `round_name` (`Final`, `Semi-Final`, `Bronze`, `Repechage`, `Quarter-Final`, `Round of 16|32|64|128`), `is_finished`, `bye`, `id_weight`, `weight`, `age`, `country_short_white/blue`.
- `competition.results` gives places 1–7 per category; `competition.competitors` gives every entrant (participation).
- Official per-athlete breakdown: `https://www.ijf.org/judoka/<id>/wrl` (use `curl -L`; server-rendered; rows = date_from, place label, competition name, points, `(100%)|(50%)`; the embedded payload also carries `idCompetition` and `externalId`). Header "Ranked on Nov 2, 2026" (a Monday).
- Breakdown truths for tests: person 20144 (seniors -60) = 5473 = 4308 (100%) + 1165 (50%); person 97658 (cadets -50) = 1110 = WC 1st 700 + CC 2nd 210 + cups 100 + 70 + 30 (7th, Bielsko-Biala); person 75902 (seniors -60) lists `Lima World Championships Juniors 2025` 3rd = 175 (50%) → JWC counts as GP in seniors; a 2023 European Championships row shows `0 (50%)`.
- `competitor.wrl_current` returns `ogq_place`, `ogq_sum_points`, `q_status`; `ijf.org/wrl_olympic` shows different numbers for the same athlete (Aghayev: API 716, page ~1216). The Olympic points method is **unknown** — Task 12 starts with an investigation gate.

## Review Focus

1. **A JudoTV link to a competition still running** → only categories whose Final `is_finished` count; others shown "בתהליך". Test in Task 4 and Task 9.
2. **Odd bouts: byes, fusen-gachi, no-shows** → a bye is not a win; a fusen-gachi win is a win; an athlete who never fought gets participation only (if the event gives it). Test in Task 4.
3. **JudoTV URL variants** (`/overview`, `/results/...`, query string, `http://`, no `www`, trailing slash, unknown code, non-JudoTV URL) → code extracted or a clear Hebrew error. Test in Task 9.
4. **IJF API slow/down or returning `[]` for a finished event** → the pipeline never overwrites a stored competition with an empty one; the site falls back to nightly data and says so. Test in Task 7 and Task 9.
5. **Athlete absent from the official list** (first points ever, or moved weight) → appears in the projected table with official 0, flagged unverified only if the engine already gives them points for the official date. Test in Task 6.

---

### Task 1: Scaffold, shared types, ISO-week decay dates

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `.gitignore`, `src/engine/types.ts`, `src/engine/dates.ts`
- Test: `tests/engine/dates.test.ts`

**Interfaces:**
- Produces (`src/engine/types.ts`):
  ```ts
  export type AgeGroup = 'sen' | 'jun' | 'cad';
  export type Gender = 'm' | 'f';
  export type EventType = 'continental_cup' | 'continental_open' | 'continental_ch' | 'grand_prix'
    | 'grand_slam' | 'masters' | 'world_ch' | 'olympic_games' | 'junior_world_ch';
  export type Place = 1 | 2 | 3 | 5 | 7 | 9 | 17 | 33 | 65 | 129;
  export interface CompetitionMeta { id: number; code: string; name: string; dateFrom: string; dateTo: string;
    age: AgeGroup; eventType: EventType; hostCountry: string /* IOC code, e.g. 'UAE' */; }
  export interface AthleteResult { competitionId: number; idPerson: number; gender: Gender; weight: string /* '-60' */;
    place: Place; wins: number; country: string; categoryFinished: boolean; }
  export interface Person { id: number; name: string; country: string; continent: string; }
  export type CategoryKey = `${AgeGroup}-${Gender}${string}`; // 'sen-m-60', 'cad-f+70'
  ```
- Produces (`src/engine/dates.ts`): `isoWeek(date: string): { year: number; week: number }`, `mondayOfIsoWeek(year: number, week: number): string`, `decayDates(meta: CompetitionMeta): { half: string; expire: string }` (ISO `YYYY-MM-DD`).

- [ ] **Step 1:** `git init`; `npm init -y`; install `typescript vite @vitejs/plugin-react react react-dom vitest @types/react @types/react-dom tsx`; `"type": "module"`; scripts `test: vitest run`, `dev: vite`, `build: vite build`, `pipeline: tsx src/pipeline/run.ts`, `fixtures: tsx scripts/record-fixtures.ts`. Vite `root: 'src/web'`, `base: './'`, `publicDir: '../../public'`, `build.outDir: '../../dist'`.
- [ ] **Step 2: Write failing tests** in `tests/engine/dates.test.ts`:
  - `isoWeek('2026-10-29')` → `{year: 2026, week: 44}`; `isoWeek('2027-01-01')` → `{year: 2026, week: 53}`.
  - `decayDates` for a Grand Slam with `dateFrom '2025-10-17'` (week 42) → `{half: '2026-10-19', expire: '2027-10-25'}` (Monday of week 43 of Y+1 / Y+2).
  - SOR example: event in week 10 of 2026 → half = Monday of week 11 2027 (`'2027-03-15'`), expire = Monday of week 11 2028 (`'2028-03-13'`).
  - Senior `continental_ch` dated `'2026-04-16'` → half `'2027-05-03'` (Monday week 18 2027), expire `'2028-05-01'` (Monday week 18 2028). Junior/cadet `continental_ch` → Monday of week 27.
  - Week 53: rule is "Monday of week W+1 of Y+1 / Y+2"; when W+1 exceeds the ISO weeks of that year, use week 1 of the following year. `dateFrom '2026-12-31'` (week 53 of 2026) → `{half: '2028-01-03', expire: '2029-01-01'}`.
- [ ] **Step 3:** Run `npx vitest run tests/engine/dates.test.ts` → FAIL (module missing).
- [ ] **Step 4:** Implement `src/engine/types.ts` and `src/engine/dates.ts`. Decay uses `dateFrom` (the official breakdown shows date_from). Continental-ch week overrides come from `src/engine/rules/` (create `src/engine/rules/decay.ts` exporting `CONTINENTAL_CH_DECAY_WEEK: Record<AgeGroup, number> = { sen: 18, jun: 27, cad: 27 }`).
- [ ] **Step 5:** Run tests → PASS. Commit `chore: scaffold project, types and ISO-week decay dates`.

### Task 2: Points tables and competition classification

**Files:**
- Create: `src/engine/rules/points.ts`, `src/engine/rules/classify.ts`
- Test: `tests/engine/points.test.ts`, `tests/engine/classify.test.ts`

**Interfaces:**
- Consumes: types from Task 1.
- Produces: `basePoints(age: AgeGroup, event: EventType, place: Place, wins: number, eventDate: string): number` (before domestic rule and decay); `classifyCompetition(code: string, name: string): { age: AgeGroup; eventType: EventType } | null` (null = gives no WRL points).

- [ ] **Step 1: Write failing tests.**
  - Senior table (spec §5.1) — assert every cell, e.g. `basePoints('sen','grand_slam',9,1,…) === 160`, `('sen','world_ch',9,1) === 320`, `('sen','masters',17,1) === 216`, `('sen','continental_ch',5,2) === 288`, `('sen','junior_world_ch',3,3) === 350`, `('sen','continental_open',3,2) === 50`.
  - Zero wins → participation: `('sen','grand_slam',33,0) === 10`, `('sen','world_ch',33,0) === 20`, `('sen','masters',17,0) === 100`, `('sen','olympic_games',17,0) === 0`.
  - One win but place 33+ → "1 contest won" column: `('sen','grand_slam',33,1) === 100`, `('sen','masters',33,1) === 0`.
  - Cadet/junior 2026 confirmed cells: `('cad','world_ch',1,5) === 700`, `('cad','continental_ch',2,3) === 210`, `('cad','continental_cup',1,4) === 100`, `('cad','continental_cup',2,3) === 70`, `('cad','continental_cup',7,1) === 30`.
  - Classification (real codes): `gs_uae2026`→sen/grand_slam; `gp_cro2026`→sen/grand_prix; `masters_2026`→sen/masters; `wc_sen2026`→sen/world_ch; `cont_open_ita2026`→sen/continental_open; `eju_sen2025`, `aju_sen2026`, `jua_sen2025`, `oju_sen2026`, `pjc_oju_sen2025`→sen/continental_ch; `cont_cup_cad_aze2026`→cad/continental_cup; `eju_cad2026`→cad/continental_ch; `oju_cad2026`→cad/continental_ch; null for `cont_cup_sen_esp2026`, `itc_jpn2026`, `jua_games2026`, `sea_tha2025`, `sag_arg2026`, `cg_gbr2026`, `eju_ss2025`, `kata_esp2026`, `eju_nw_lat2026`, `wcup_ibsa_geo2025`, `pjc_cag2025`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Senior rows: copy the table in spec §5.1 verbatim (columns 1/2/3/5/7/9/17/one-win/participation). Junior/cadet 2026: extract the SOR tables (pp. 53–54) with `pdftotext -raw -f 53 -l 54` on the SOR PDF (download from `https://sor.ijf.org`, follow redirect, ~30 MB, into `%TEMP%`, not the repo) to resolve the column misalignment; the tests above are the confirmed anchors. Junior/cadet rows have columns 1/2/3/5/7/1-16/1-32/1-64/each-contest-won/participation; map Place 9→1/16, 17→1/32, 33→1/64. Results dated before `2026-01-01` for jun/cad use the pre-2026 table: if SOR 2025 cannot be found, use the 2026 table and add a `// UNVERIFIED pre-2026 jun/cad` comment; the validation report (Task 7) will expose the gap. Classification is by `code` regex (name only as a tiebreaker); also match `wc_jun*` → sen view handled in Task 5, classified as `{age:'jun', eventType:'world_ch'}`; `wc_cad*` → cad/world_ch; `gp_jun_*`/`gp_cad_*` → grand_prix of that age; `cont_cup_jun_*` → jun/continental_cup; `oly*` → sen/olympic_games.
- [ ] **Step 4:** Run → PASS. Commit `feat(engine): points tables and competition classification`.

### Task 3: IJF API client and recorded fixtures

**Files:**
- Create: `src/data/ijf-api.ts`, `src/data/breakdown.ts`, `scripts/record-fixtures.ts`, `tests/fixtures/**`
- Test: `tests/data/breakdown.test.ts`

**Interfaces:**
- Produces (`src/data/ijf-api.ts`, works in Node 24 and browsers via global `fetch`):
  `apiGet<T>(action: string, params?: Record<string, string | number>): Promise<T>` (throws `IjfApiError` on HTTP error, timeout 30 s, or `{error: …}` body);
  `getCompetitionList(year: number): Promise<RawCompetition[]>`, `getCompetitionInfo(id: number): Promise<RawCompetitionInfo | null>` (null for an unused id), `getContests(id: number): Promise<RawContest[]>`, `getCompetitors(id: number): Promise<RawCompetitorsResponse>`, `getResults(id: number): Promise<RawResultsResponse>`, `getOfficialRanking(): Promise<RawRankingRow[]>`, `getWrlCurrent(idPerson: number): Promise<RawWrlCurrent[]>`, `getWrlHistory(idPerson: number): Promise<RawWrlHistory[]>` — the `Raw*` interfaces live in the same file and mirror the API fields listed under "Facts pinned".
- Produces (`src/data/breakdown.ts`): `parseBreakdownPage(html: string): { rankedOn: string; age: AgeGroup; rows: { date: string; placeLabel: string; competitionName: string; competitionCode: string | null; points: number; percent: 100 | 50 }[] }` — used only by tests and Task 12 research.

- [ ] **Step 1:** Write `scripts/record-fixtures.ts` that saves raw JSON/HTML into `tests/fixtures/`: competitions 3157 (Abu Dhabi GS 2026), 3151 (Baku WC 2026), 3191 (Ganja cadet cup 2026), 3159 (Zagreb GP 2026 — currently running, keep as `partial-3159`), and one junior competition found by id scan near 3191 (its `id_weight` values confirm the junior weight ids); `ranking.get_list` (full); breakdown pages for 20144, 75902, 97658. Run `npm run fixtures`. Commit fixtures.
- [ ] **Step 2: Write failing tests** for `parseBreakdownPage` on the 20144 fixture: `rankedOn === '2026-11-02'`, 12 rows, sum of `points` where `percent===100` is 4308, where `percent===50` is 1165, row 0 = `{date:'2026-10-29', placeLabel:'1. place', points:1000, competitionCode:'gs_uae2026'}`. On 97658: 5 rows summing 1110, `age === 'cad'`.
- [ ] **Step 3:** Run → FAIL. **Step 4:** Implement (strip `<style>`/`<script>`, read rows; take `externalId` from the embedded payload). **Step 5:** Run → PASS. Commit `feat(data): IJF API client, breakdown parser, fixtures`.

### Task 4: Derive each athlete's final place from bouts

**Files:**
- Create: `src/engine/placings.ts`
- Test: `tests/engine/placings.test.ts`

**Interfaces:**
- Consumes: `Raw*` contest/competitor/result types (Task 3), `AthleteResult`, `CompetitionMeta`.
- Produces: `derivePlacings(meta: CompetitionMeta, contests: RawContest[], competitors: RawCompetitorsResponse, results: RawResultsResponse): AthleteResult[]`.

Rules: places 1–7 from `competition.results` when present, otherwise from bouts (Final winner 1 / loser 2; Bronze winners 3 / losers 5; Repechage losers 7). Everyone else: place by the round of their last loss — Quarter-Final losers not in repechage are not possible in IJF format; `Round of 16` loss → 9, `Round of 32` → 17, `Round of 64` → 33, `Round of 128` → 65. Pool/round-robin categories (small entries): place from `competition.results`, others 9. `wins` = finished bouts where `id_winner` = athlete and `bye` is falsy. Entrants in `competitors` who never fought → place = lowest place of the draw, wins 0. `categoryFinished` = the category's `Final` bout has `is_finished` truthy.

- [ ] **Step 1: Write failing tests** from fixtures: in 3157, person 20144 place 1, wins ≥ 4; in 3151, 20144 place 9 (breakdown says "1/16") with wins ≥ 1; in 3191, person 97658 (cadet -50) has place 2 (breakdown: Ganja 2nd = 70) and the two bronze-bout winners of that category have place 3; every athlete in `competitors` of 3157 appears exactly once; a bye bout never increments `wins`; in `partial-3159` categories without a finished Final have `categoryFinished === false` and finished ones `true`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. Commit `feat(engine): derive placings from bouts`.

### Task 5: Scoring, best-results counting, ranking

**Files:**
- Create: `src/engine/scoring.ts`, `src/engine/ranking.ts`, `src/engine/rules/counting.ts`
- Test: `tests/engine/ranking.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 4.
- Produces:
  ```ts
  export interface ScoredResult { result: AthleteResult; meta: CompetitionMeta; base: number; period: 'current' | 'previous' | 'expired';
    value: number /* after domestic rule and 100/50/0% */; counted: boolean; halfDate: string; expireDate: string; }
  export interface RankingEntry { idPerson: number; category: CategoryKey; points: number; place: number; results: ScoredResult[]; }
  export function scoreResults(results: AthleteResult[], comps: Map<number, CompetitionMeta>, rankingDate: string,
    view: AgeGroup, officialPlace: (id: number, cat: CategoryKey) => number | undefined): ScoredResult[];
  export function computeRanking(results: AthleteResult[], comps: Map<number, CompetitionMeta>, rankingDate: string,
    view: AgeGroup, officialPlace: (id: number, cat: CategoryKey) => number | undefined): Map<CategoryKey, RankingEntry[]>;
  ```

Rules (from spec §5.1): `view` is the ranking being built; a `jun` `world_ch` result also enters the `sen` view as `junior_world_ch` (GP values), mapped to the senior category with the same weight label. Domestic rule: GS/GP (sen) and GP (jun/cad): among athletes with `country === meta.hostCountry` in the category, only the 2 best places score, ties broken by better `officialPlace`; JWC: 9 best host men + 9 best host women across categories; cadet WC: 10 + 10. Period: `rankingDate < halfDate` → current (100%), `< expireDate` → previous (50%), else expired. Counting `sen`: best 6 current + best 6 previous (by value). `jun`/`cad` per period: best 3 of `grand_prix`+`continental_cup`, plus the latest `continental_ch`, plus the latest `world_ch`. Tie-breaks: sen = sum of counted world_ch → sum of counted GP/GS/masters → highest single counted value, then second…; jun/cad per spec §5.1 (WC → GP → CC → cups → single values). Results with `categoryFinished === false` are ignored.

- [ ] **Step 1: Write failing tests:**
  - Rebuild 20144 from the breakdown fixture rows (convert each row to an `AthleteResult` + `CompetitionMeta` via `classifyCompetition(code)`) at `rankingDate '2026-11-02'` → points 5473, counted current values sum 4308, previous 1165, 2023 European Ch row counts as `value 0`.
  - Same for 97658 cadets at `'2026-10-26'` → 1110.
  - 75902 (seniors view) at `'2026-11-02'` → 2517 (current 1890 + previous 627; the Lima JWC 2025 row is `junior_world_ch` 3rd = 350 → 175). At `'2026-11-16'` (Monday of week 47: Montreal Open 2024, week 46, expires) → 2492.
  - 7 current results of 100 each + 1 of 1000 → only best 6 count.
  - Domestic: 3 UAE athletes placed 3, 5, 7 at a UAE GS → the 7th place gets `value 0`.
  - Tie: two athletes at 1000; one has a counted world_ch result → ranked higher.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. Commit `feat(engine): scoring, best-results counting and ranking`.

### Task 6: Projection = official + engine delta

**Files:**
- Create: `src/engine/projection.ts`
- Test: `tests/engine/projection.test.ts`

**Interfaces:**
- Consumes: `computeRanking` (Task 5).
- Produces:
  ```ts
  export interface OfficialEntry { idPerson: number; category: CategoryKey; place: number; points: number; }
  export interface ProjectedEntry { idPerson: number; category: CategoryKey; officialPlace: number | null; officialPoints: number;
    projectedPoints: number; projectedPlace: number; delta: number; verified: boolean; engine: RankingEntry | null; }
  export function project(official: OfficialEntry[], before: Map<CategoryKey, RankingEntry[]>,
    after: Map<CategoryKey, RankingEntry[]>): Map<CategoryKey, ProjectedEntry[]>;
  ```
  `before` = engine on competitions already in the official list at the official date; `after` = engine with the selected pending competitions at the target date. `projectedPoints = officialPoints + (after − before)`; `verified = |before − officialPoints| < 0.5`; sort by `projectedPoints`, ties by the `after` engine order.

- [ ] **Step 1: Write failing tests:** no pending competitions and same date → every `projectedPoints === officialPoints`, `delta 0`, order identical to official; athlete with official 5473 but engine-before 5400 → `verified false`, and a new 1000-point win still adds exactly the engine delta; athlete absent from official with engine-after 700 → appears with `officialPlace null`, `projectedPoints 700`, `verified true`; athlete absent from official but engine-before 50 → `verified false`.
- [ ] **Step 2–4:** FAIL → implement → PASS. Commit `feat(engine): official-plus-delta projection`.

### Task 7: Nightly pipeline and validation report

**Files:**
- Create: `src/data/competition-loader.ts`, `src/pipeline/run.ts`, `src/pipeline/discover.ts`, `src/pipeline/validate.ts`, `public/data/` (generated)
- Test: `tests/pipeline/discover.test.ts`, `tests/pipeline/run.test.ts`

**Interfaces:**
- Produces (`src/data/competition-loader.ts`, shared with the browser): `loadCompetition(meta: CompetitionMeta): Promise<{ results: AthleteResult[]; persons: Person[] }>` (calls contests + competitors + results, then `derivePlacings`).
- Produces static files (the site's contract):
  - `public/data/meta.json`: `{ generatedAt: string; officialDates: Record<\`${AgeGroup}-${Gender}\`, string>; competitions: (CompetitionMeta & { hasResults: boolean })[] }` — all classified competitions from 26 months ago up to +60 days (future ones let the site resolve JudoTV codes).
  - `public/data/results-<age>.json`: `Record<competitionId, AthleteResult[]>`.
  - `public/data/official-<age>.json`: `OfficialEntry[]`.
  - `public/data/persons.json`: `Record<idPerson, Person>`.
  - `public/data/validation.json`: `{ [age]: { checked: number; matched: number; mismatches: { idPerson: number; category: CategoryKey; official: number; engine: number }[] } }` (first 200 mismatches).
- `discover.ts`: `discoverCompetitions(knownIndex, fetchInfo): Promise<CompetitionMeta[]>` — senior events from `competition.get_list` for the last 3 years; junior/cadet by scanning `competition.info` ids from `max(knownMaxId) − 50` to `+150` (first run: from the lowest id dated ≥ 26 months ago), stopping after 40 consecutive empty ids; keeps a cache file `data-cache/competition-index.json` (committed) so ids are scanned once.
- Official dates: for each age-gender, `getWrlHistory` of that list's #1 athlete; version `world_ranking_<age>_<YYYY>_<WW>` → Monday of ISO week `WW` (verify against the fixture's "Ranked on Nov 2, 2026"; if it doesn't match, fall back to parsing "Ranked on" from that athlete's breakdown page).
- Competitions "included in official" = `dateTo < officialDate` for that age-gender.

- [ ] **Step 1: Write failing tests** with a fake fetch: discovery stops after 40 empty ids; a competition whose fresh load returns 0 results while the stored file has results is **kept** (Review Focus 4); a stored competition is not refetched unless `updated_at_ts` changed or it ended < 14 days ago; `run` on fixtures writes all five files with the shapes above.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Run the real pipeline once: `npm run pipeline`. Expected: files written; `validation.json` shows `matched/checked`. Target ≥ 98% for `sen`. If lower, inspect mismatches against breakdown pages (`curl -L https://www.ijf.org/judoka/<id>/wrl`), fix the rule in `src/engine/rules/`, add a regression test, rerun. Record the final match rates in `docs/validation-notes.md`, including known gaps (e.g. pre-2026 jun/cad table).
- [ ] **Step 6:** Commit `feat(pipeline): nightly data build and validation` (include generated `public/data`).

### Task 8: GitHub repo, nightly Action, Pages deploy

**Files:**
- Create: `.github/workflows/nightly.yml`, `README.md`

- [ ] **Step 1:** Workflow: triggers `schedule: '0 3 * * *'` (05:00 Israel) and `workflow_dispatch`; Node 24; `npm ci`; `npm test`; `npm run pipeline`; commit changed `public/data` + `data-cache` as `github-actions[bot]` only if changed; `npm run build`; deploy `dist/` with `actions/upload-pages-artifact` + `actions/deploy-pages`. Permissions: `contents: write`, `pages: write`, `id-token: write`. The pipeline step failing must not deploy.
- [ ] **Step 2:** README (Hebrew): what the site does, how to run locally (`npm run dev`), how to trigger the Action manually.
- [ ] **Step 3: Stop and ask the user** for their GitHub username and OK to create a public repo `judo-ranking-calculator` with `gh repo create`, push, and enable Pages (source: GitHub Actions). Do nothing on GitHub before that answer.
- [ ] **Step 4:** After OK: create, push, run the workflow via `gh workflow run nightly.yml`, confirm it succeeds (`gh run watch`) and the Pages URL serves `data/meta.json`. Commit `ci: nightly data build and Pages deploy`.

### Task 9: Site shell, data loading, adding a JudoTV competition

**Files:**
- Create: `src/web/index.html`, `src/web/main.tsx`, `src/web/App.tsx`, `src/web/strings.ts`, `src/web/styles.css`, `src/web/state/useData.ts`, `src/web/state/useScenario.ts`, `src/web/judotv.ts`
- Test: `tests/web/judotv.test.ts`, `tests/web/scenario.test.ts`

**Interfaces:**
- Consumes: data files (Task 7), `loadCompetition` (Task 7), `computeRanking` / `project` (Tasks 5–6).
- Produces: `parseJudoTvUrl(input: string): { code: string } | { error: 'not_judotv' | 'no_code' }`;
  `useData(): { status: 'loading' | 'ready' | 'error'; meta; persons; official(age); results(age) }` (lazy per age);
  `useScenario()` state: `{ age: AgeGroup; gender: Gender; weight: string; added: number[] /* competition ids */; targetDate: string }` persisted in the URL hash (`#/sen/m/-60?add=3159,3169&date=2026-11-16`);
  `buildProjection(data, scenario): Map<CategoryKey, ProjectedEntry[]>` (pure, in `useScenario.ts`).
- Behaviour: home screen picks age/gender/weight; input "הדבק קישור JudoTV" → resolve code via `meta.competitions`, else `competition.get_list` for that year; load results live (`loadCompetition`), cache in memory; list "תחרויות שעוד לא נכנסו לדירוג הרשמי" = `meta.competitions` with `hasResults` and `dateTo ≥ officialDate`, each with a toggle (pre-selected: none); default `targetDate` = Monday after the latest added competition's `dateTo`, editable; validation badge from `validation.json` ("התאמה לרשמי: 99.4%"); data date "עודכן: …". Live fetch failure → message "לא הצלחנו למשוך את התחרות מה-IJF — מוצגים נתוני הלילה" and the competition is used from nightly data if present.

- [ ] **Step 1: Write failing tests:** `parseJudoTvUrl` for `https://www.judotv.com/competitions/gp_cro2026/overview`, `http://judotv.com/competitions/gp_cro2026`, `https://www.judotv.com/competitions/gp_cro2026/results/m-60?x=1`, `judotv.com/competitions/gp_cro2026/` → code `gp_cro2026`; `https://www.ijf.org/x` → `not_judotv`; `https://www.judotv.com/videos/123` → `no_code`. `buildProjection` with fixtures: adding `partial-3159` changes only categories whose Final finished; default target date for an event ending Sun 15.11.2026 is `2026-11-16`.
- [ ] **Step 2–4:** FAIL → implement → PASS. Check in `npm run dev` at 360px width: RTL, loads, adding the Zagreb link works. Commit `feat(web): shell, data loading, JudoTV competitions`.

### Task 10: Category table and athlete breakdown screens

**Files:**
- Create: `src/web/screens/CategoryTable.tsx`, `src/web/screens/AthleteBreakdown.tsx`
- Test: `tests/web/format.test.ts` (pure helpers only)

**Interfaces:**
- Consumes: `ProjectedEntry`, `ScoredResult`, `Person`.
- Produces: `formatMovement(officialPlace: number | null, projectedPlace: number): { label: string; dir: 'up' | 'down' | 'same' | 'new' }`.
- Table columns: מקום מחושב · שינוי (▲3 / ▼2 / — / חדש) · שם · מדינה · נקודות (and "+delta" in small text) · "לא מאומת" chip when `!verified`. Rows of athletes affected by added competitions are highlighted. Tap a row → breakdown: two sections "12 חודשים אחרונים (100%)" and "13–24 חודשים (50%)" (jun/cad: grouped as 3 best + אליפות יבשת + אליפות עולם), each result with date, competition, place, points, counted/not counted, and "יורד ל-50% ב-…" / "פג ב-…"; results from added competitions marked "חדש".

- [ ] **Step 1:** Failing tests for `formatMovement`: (5,2)→up '▲3'; (2,5)→down '▼3'; (4,4)→same; (null,7)→new 'חדש'.
- [ ] **Step 2–4:** FAIL → implement → PASS; manual check on phone width with the Zagreb scenario. Commit `feat(web): category table and athlete breakdown`.

### Task 11: Watch list

**Files:**
- Create: `src/web/state/watchlist.ts`, `src/web/screens/WatchList.tsx`
- Test: `tests/web/watchlist.test.ts`

**Interfaces:**
- Produces: `loadWatchlist(): number[]`, `saveWatchlist(ids: number[]): void` (localStorage key `watchlist.v1`, wrapped in try/catch, returns `[]` when unavailable); `encodeWatchlist(ids: number[]): string` / `decodeWatchlist(s: string): number[]` for the share link `#/watch?ids=…`.
- Screen: star toggle on table rows and breakdown; watch list shows each athlete's category, projected world place + change, and (after Task 12) Olympic place/status; opening a share link offers "להוסיף לרשימה שלי?".

- [ ] **Step 1:** Failing tests: encode/decode round-trip; decode ignores junk (`'1,a,,3'` → `[1,3]`); `loadWatchlist` returns `[]` when `localStorage` throws.
- [ ] **Step 2–4:** FAIL → implement → PASS. Commit `feat(web): watch list with share link`.

### Task 12: Olympic ranking (LA28) — investigation gate, then allocation and screen

**Files:**
- Create: `docs/research/olympic-points.md`, `src/engine/olympic.ts`, `src/engine/rules/la28.ts`, `src/web/screens/Olympic.tsx`
- Test: `tests/engine/olympic.test.ts`

**Interfaces:**
- Produces: `olympicPoints(results, comps, rankingDate): Map<CategoryKey, RankingEntry[]>` (method decided in Step 1);
  `allocateQuotas(ranking: Map<CategoryKey, RankingEntry[]>, persons: Record<number, Person>): Map<number, OlympicStatus>` with
  `type OlympicStatus = { kind: 'direct' | 'continental' | 'host' | 'noc_blocked' | 'out'; olympicPlace: number }`.
- `src/engine/rules/la28.ts`: `WINDOW = { from: '2026-06-15', to: '2028-06-12' }`, `DIRECT_PER_CATEGORY = 17`, `HOST = 'USA'`, `CONTINENTAL_QUOTA = { Africa: {m:12,f:12}, Europe: {m:13,f:13}, Asia: {m:12,f:12}, Oceania: {m:4,f:4}, Americas: {m:11,f:11} }`.

- [ ] **Step 1 (gate): Find how Olympic points are computed.** Record official Olympic data for ~40 senior athletes: `ijf.org/wrl_olympic` (parse its embedded payload; it lists points, place and status per category) and `competitor.wrl_current` (`ogq_sum_points`). Note that they disagree today (Aghayev 716 vs ~1216). Test hypotheses against WRL breakdown rows inside the window: H1 same rules restricted to the window; H2 window results × 50% until 12 months before the window end; H3 a different points table; others suggested by the data. Write findings to `docs/research/olympic-points.md`. **If no hypothesis reproduces ≥ 95% of the sample, stop the task and report to the user** with the findings; do not build allocation on a guess.
- [ ] **Step 2: Write failing tests** for `allocateQuotas` (spec §5.2): two FRA athletes at places 3 and 5 in one category → the first is `direct`, the second `noc_blocked`, and place 18 becomes `direct`; USA athlete in the top 17 → `host` and does not consume a direct slot; continental: build a Europe list across categories/genders excluding qualified athletes, give 13 men + 13 women, max one per NOC across all categories; unfilled continental slots go to the best remaining athlete of that gender worldwide (max one per NOC per category); ties use the senior tie-break from Task 5. Plus the Step 1 sample: computed points match recorded official points.
- [ ] **Step 3–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Olympic screen: per category, line after place 17, status chips (עלה ישירות / מכסה יבשתית / מדינה מארחת / חסום — יש ספורטאי מאותה מדינה / בחוץ), projected vs official status; continental table per continent. Add Olympic place/status to the watch list. Commit `feat: LA28 Olympic ranking and quota status`.
