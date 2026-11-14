# Validation notes

How well the engine reproduces the official IJF world ranking, as checked by the nightly pipeline
(`npm run pipeline`, report in `public/data/validation.json`). First measured 2026-11-14.

## Method

- For each age group and gender, every athlete of the official list (`ranking.get_list`) is compared with the
  engine total for the same person and category on the list's date, computed only from competitions that ended
  before that date (engine missing = 0). Matched = difference below 0.5 point.
- The domestic rule uses the current official places.
- **List date.** `competitor.wrl_history` versions `world_ranking_<age>_<YYYY>_<WW>` are the Monday of ISO week
  WW (verified: 20144 `world_ranking_sen_2026_45` = breakdown page "Ranked on Nov 2, 2026"). But on 2026-11-14 the
  live `ranking.get_list` was one list newer than both wrl_history and the breakdown pages: it already held the
  results of the 2026-11-07/08 events (2026-11-09 list). The pipeline therefore starts from the wrl_history date
  (breakdown page "Ranked on" when the #1 athlete's history does not match the list) and takes the Monday up to
  today on which the engine matches the most totals (logged each run). 2026-11-14: all six lists → 2026-11-09
  (seniors 6,446 vs 5,729 matched on 2026-11-02).

## Match rates (2026-11-14, official date 2026-11-09)

| Age | Checked | Matched | Rate |
|---|---|---|---|
| Seniors | 6,581 | 6,446 | 97.95% |
| Juniors | 5,595 | 5,531 | 98.86% |
| Cadets | 6,925 | 6,888 | 99.47% |

Before the Task 7 fixes (same data, official date taken as 2026-11-02): seniors 82.81%, juniors 41.38%,
cadets 46.18%.

## Rules found or corrected (each with a regression test)

| Rule | Where | Evidence | Effect (sen mismatches) |
|---|---|---|---|
| Official list date = best-matching Monday from the wrl_history date | `pipeline/validate.ts` | see above | 1131 → 452 |
| Gold Coast Oceania Open 2025 (`cont_open_2_aus2025`) scores as a Grand Prix, GP domestic quota | `rules/classify.ts` | 1st 700, 2nd 490, 3rd 350, 5th 252, participation 6 on ~15 pages | 452 → 345 |
| `gs_deaf_*`, `gs_adapted_*`, `oly_teams*` give no points | `rules/classify.ts` | not WRL events | — |
| No-shows: an athlete whose only bouts are walkover losses (00:00:00, no hajime timestamp, single ippon) or who has no bout in a finished category gets no result | `placings.ts` | "participation 0" rows; walkover-loss athletes mostly 0 | 345 → ~275 |
| Places 1-7 come only from the published results: an athlete not listed there is not 5th/7th (repechage from the last 16: an early repechage loss is "fights won") | `placings.ts` | cont_cup_jun_ita2026, cont_cup_jun_usa2026 | jun/cad +6 points |
| Pool categories (≤5 fighters, no Final) are finished when all bouts are and places are published; published 4th/6th score as 5th/7th | `placings.ts` | 243 categories were left "unfinished"; oju_sen2026 4th = "5. place" | 275 → 204 |
| Continental opens before 2025 give no participation points | `rules/points.ts` | Nov 2024 opens: no participation rows, "7. place 0" without a win; Jan 2025 on: 2 | 204 → 162 |
| Domestic quota: a host with a won contest goes before an equally placed host without one | `rules/domestic.ts` | gs_mgl2025 -60 | 162 → 142 |
| Senior world championships: 9 host athletes per gender score | `rules/domestic.ts` | wc_sen2026 (AZE): 8 medal/5th men + best-ranked 9th scored, three 9ths "1/16 0"; wc_sen2025 fits | 142 → 136 |
| Bout without a winner (withdrawal) ends the athlete's run in that round | `placings.ts` | gp_aut2026: official 1/32 | 136 → 135 |
| Bouts flagged `bye: '1'` but with two competitors and a winner count as contests won | `placings.ts` | cont_cup_jun_uzb2026 (14 such bouts): "fights won 6" | jun/cad |
| Pre-2026 junior/cadet table (below) | `rules/points.ts` | ~600 breakdown rows | jun 51.9% → 98.7%, cad 64.8% → 99.4% |

`PLACINGS_VERSION` (now 2) is stored with each cached competition; a bump makes the pipeline re-derive them.

### Pre-2026 junior/cadet points (read off official breakdown pages; juniors and cadets agree)

| Event | 1 | 2 | 3 | 5 | 7 | per contest won (below 7th) | participation |
|---|---|---|---|---|---|---|---|
| Continental cup | 100 | 60 | 40 | 20 | 16 | 2 | 0 |
| Continental championship | 200 | 120 | 80 | 40 | 32 | 6 | 2 |
| World championship | 500 | 300 | 200* | 100* | 80 | 12 (no 1/16 column) | 4 |
| Grand Prix | 2026 values kept* | | | | | | |

\* Unverified: no page seen (WC 3rd/5th follow the 5× continental-cup pattern of 1st/2nd/7th); no pre-2026
junior/cadet Grand Prix is in the data window. The 2026 combination rule (places 1-7 → place value; below that,
the 1/16-1/64 column when the table has one, else wins × per-contest value; no win → participation) matches the
2026 rows seen.

## Remaining mismatches (known gaps)

- **No-show participation (most of the senior remainder, differences of 1-10 points).** Some athletes who lost by
  walkover still get participation points, others do not, with identical bout records (same event, same round,
  e.g. cont_open_jor2025 93485 vs 93059). Probably weigh-in data that the API does not expose. Dropping walkover
  losers is the better of the two choices (204 vs 269 senior mismatches when measured).
- **Host quota ties.** Between host athletes with the same place and wins the official choice does not always
  follow the current official place (gs_mgl2025 47891 over 55051, gs_kaz2025 23096 over 70528); probably the
  ranking at the time of the event. wc_sen2025 / wc_jun2025 (senior view) exclude some hosts in an order that is
  not by place either.
- **Person merges.** A few athletes have official rows for competitions where the API lists them under no or
  another id (e.g. 98679 cont_open_ita2025, 102884/102885).
- **Junior/cadet 2026 continental cups:** about a quarter of participation rows show 0 (e.g. cont_cup_jun_kaz2026)
  with no visible difference from those that get 2.
- 45 persons have no continent (their country never appears in a results payload's top places).

## Olympic ranking (LA28), first measured 2026-11-14

How the Olympic points are counted: `docs/research/olympic-points.md`. The nightly run asks
`competitor.wrl_current` for the best 40 of each senior category and the best 40 of each continent and gender by
engine Olympic points (653 athletes, about 60-120 s), dates that list by the best engine match (its Olympic fields
lag: the 2026-10-12 list on 2026-11-14) and writes `olympic-official.json` plus `validation.json` → `olympic`.

| Check | Result |
|---|---|
| Engine Olympic totals vs `ogq_sum_points` (list 2026-10-12) | 625/631 = 99.05% |
| Engine vs the ijf.org Olympic page (top 24 per gender, list 2026-11-02) | 48/48 |
| Computed status vs `q_status` (allocation on the official points) | 618/619 = 99.84%: direct 238/238, NOC-blocked 73/73, continental 69/69, host 12/12, out 226/227 |

- The 6 total mismatches are the WRL gaps above (participation points, the 102884 person merge).
- The one status disagreement: 73963 (NIG, -63, 45 points) computed continental, official out; not explained.
- 12 asked athletes have codes the allocation does not produce (5 "returned quota", 11/12/17/18); they are left out
  of the status check. An athlete ranked in two categories has a status only in one (official: the other is null).
