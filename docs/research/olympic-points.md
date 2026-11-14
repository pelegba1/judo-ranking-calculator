# How the LA28 Olympic ranking points are computed

Investigation gate of Task 12, done 2026-11-14. Question: how does the IJF compute the points of the "World
Ranking List of the Olympic qualification period" (spec 5.2), so the engine can reproduce them?

## Conclusion

**H2 reproduces the official Olympic points: 785 of 791 sampled athletes (99.2%) — 48/48 on the ijf.org page,
737/743 in the API.** The Olympic list is the senior WRL computed with the same points table, domestic rule,
best-6 counting and tie-breaks, restricted to the qualification window, with a different split into periods:

- Only competitions starting on or after **2026-06-15** (window start) count; the window ends 2028-06-12.
- Results of the **first year** of the window count **50%**, results of the **second year 100%**. On the official
  page all current results sit in the `previousPoints` bucket (6 slots, values = base × 0.5) and `latestPoints`
  is empty: the same two-bucket structure as the WRL ("latest" 100% / "previous" 50%).
- **Best 6 per bucket** (as the WRL). Evidence: 35892 (-81) has 7 window results; best 6 = 226 = official,
  all 7 = 229, best 5 = 223.
- Continental opens count (dropping them: 80.1%).
- **Unverified** (no data yet): the exact first/second year boundary. The window is exactly 104 weeks
  (Mon 2026-06-15 to Mon 2028-06-12); the rule uses the Monday 52 weeks in, **2027-06-14**, and the
  competition's start date (a competition on the weekend of 12-13 June 2027 counts 50%). Whether the junior
  world championship counts in the Olympic list as it does in the WRL is unknown too (wc_jun2026 is on
  2026-11-19); it is kept, as in the WRL.

The six API mismatches are the known WRL gaps (validation-notes.md): participation points of 1-5
(13028 +5, 14772 -1, 20137 -3, 31371 -1, 45549 -3) and a person merge (102884, official 286, engine 160).

## Sources

1. **`https://www.ijf.org/wrl_olympic`** → redirects to `https://ijf.org/world-ranking/olympic`, a server-rendered
   Nuxt page. Its `__NUXT_DATA__` payload (devalue format) holds the vue-query cache; the query
   `["rankings","list","infinite",24,{"Type":"olympic","Gender":"m"}]` is the first page (24 rows) of the men's
   list across all categories, sorted by points; `?category=all_female` gives the women. Each row has
   `judoka`, `weightCategory`, `place` (place in the category), `totalPoints`, `latestPoints` / `previousPoints`
   (6 slots each: points, place, competition), and `ogq: {status: {idStatus, short}, place}` (`ogq.place` = order
   among the direct qualifiers of the category, null when not direct). Only the first page is server-rendered:
   later pages come from a client API that we could not reach (`/Rankings` is not exposed same-origin).
   The query `["rankings","teams","olympic"]` lists every NOC's candidates with `ogqStatus.idStatus` (no points).
   Status codes, from the page script: 0 Not qualified, 1 Qualified (direct), 2 Continental quota,
   3 Qualified* (not the highest ranked of the NOC in the category), 4 Host nation, 5 Returned quota,
   10 Ineligible, 11 Continental quota (undetermined), 12 Team invitation, 17 Undetermined,
   18 Returned team invitation. On 2026-11-14: 238 athletes with status 1 (= 14 × 17: USA athletes in the top
   17 do not take a direct place), 98 with 2, 78 with 3, 86 with 4 (every USA candidate).
2. **`competitor.wrl_current&params[id_person]=N`** (data.ijf.org API): `ogq_sum_points`, `ogq_place` (place in the
   Olympic category list), `q_status` (same codes). **The API's Olympic fields lag the page:** on 2026-11-14 they
   match the engine on the **2026-10-12** list (99.2%), while the API's own WRL points and the page are on the
   2026-11-09 / 2026-11-02 list. This explains the "716 vs 1216" of Aghayev: the API lacks gs_uae2026
   (1st, 1000 × 50% = 500) and the page has it. Fetched for the top 60 of each senior category of the official
   WRL (840 athletes; 743 rows with Olympic points).

## Hypotheses and match rates

Engine: `scoreResults` over the nightly `results-sen.json` + `results-jun.json`, competitions with
dateFrom ≥ window start and dateTo < list date, then each hypothesis's factor and best-N. Match = |diff| < 0.5.
Page sample = 48 athletes (top 24 men + top 24 women, all 14 categories); API sample = 743 athletes.

| Hypothesis | page, list 2026-11-02 | page, 2026-11-09 | API, 2026-10-12 | API, 2026-10-19 | API, 2026-11-09 |
|---|---|---|---|---|---|
| H1 WRL rules restricted to the window (100%, best 6) | 0% | 0% | 0% | 0% | 0% |
| **H2 year 1 × 50%, year 2 × 100%, best 6 per year** | **100%** | **100%** | **99.2%** | 98.7% | 61.4% |
| H2 without a best-N cap | 100% | 100% | 99.1% | 98.5% | 61.2% |
| H2 best 5 per year | 93.8% | 93.8% | 97.6% | 97.0% | 61.5% |
| H2 without continental opens | 100% | 100% | 80.1% | 80.1% | 53.8% |
| H3 a different points table | — | — | — | — | — |
| H4 the Olympic list has its own date | (see API column) | | | | |

- **H1** is off by exactly 2× everywhere: window results are worth half.
- **H3** rejected: every slot on the page equals the WRL table value × 0.5 (GS 1st 500, WC 1st 1000, GP 1st 350,
  GP 1/16 56, GP participation 3, WC 5th 360, …).
- **H4** confirmed for the API only: its Olympic fields belong to an older list (2026-10-12) than its WRL
  fields. The page is current. The pipeline therefore picks the API's Olympic list date the same way it picks the
  WRL date: the Monday on which the engine matches the most API totals.

### API sample per category (H2, list 2026-10-12)

| category | API rows | matched (H2, 2026-10-12) |
|---|---|---|
| sen-f+78 | 46 | 45 |
| sen-f-48 | 52 | 52 |
| sen-f-52 | 52 | 52 |
| sen-f-57 | 51 | 49 |
| sen-f-63 | 53 | 53 |
| sen-f-70 | 53 | 53 |
| sen-f-78 | 52 | 52 |
| sen-m+100 | 52 | 52 |
| sen-m-100 | 56 | 56 |
| sen-m-60 | 54 | 53 |
| sen-m-66 | 56 | 55 |
| sen-m-73 | 55 | 55 |
| sen-m-81 | 60 | 59 |
| sen-m-90 | 51 | 51 |

### Page sample (2026-11-14; engine H2 on the 2026-11-09 list; API = lagging Olympic fields)

| id | athlete | NOC | cat | official (page) | engine H2 | API ogq_sum_points | official status |
|---|---|---|---|---|---|---|---|
| 39933 | PIRELLI | ITA | sen-m-100 | 1850 | 1850 | 1850 | directly |
| 21360 | TASOEV | RUS | sen-m+100 | 1750 | 1750 | 1750 | directly |
| 38158 | SULAMANIDZE | GEO | sen-m-100 | 1750 | 1750 | 1750 | directly |
| 44249 | MURAO | JPN | sen-m-90 | 1500 | 1500 | 1500 | directly |
| 29091 | YUSIFOV | AZE | sen-m-60 | 1360 | 1360 | 1360 | directly |
| 13208 | ABE | JPN | sen-m-66 | 1350 | 1350 | 1350 | directly |
| 20144 | AGHAYEV | AZE | sen-m-60 | 1216 | 1216 | 716 | directly (nation) |
| 30188 | MAMMADALIYEV | AZE | sen-m-73 | 1176 | 1176 | 1176 | directly |
| 68106 | RUTOVIC | SRB | sen-m-90 | 1156 | 1156 | 1156 | directly |
| 83525 | BIFOV | RUS | sen-m-100 | 1155 | 1155 | 655 | directly |
| 23870 | GARCIA TORNE | ESP | sen-m-66 | 1130 | 1130 | 1130 | directly |
| 59853 | SIMIN | SRB | sen-m-81 | 1100 | 1100 | 1100 | directly |
| 13844 | PUUMALAINEN | FIN | sen-m+100 | 1070 | 1070 | 890 | directly |
| 69037 | TANAKA | JPN | sen-m-73 | 1060 | 1060 | 1060 | directly |
| 13278 | KOKAURI | AZE | sen-m+100 | 1058 | 1058 | 708 | directly |
| 51301 | TCKAEV | AZE | sen-m-81 | 1055 | 1055 | 1055 | directly |
| 46230 | LATISEV | MDA | sen-m-90 | 1010 | 1010 | 660 | directly |
| 57666 | TAKEOKA | JPN | sen-m-66 | 1000 | 1000 | 1000 | directly (nation) |
| 30227 | GRIGALASHVILI | GEO | sen-m-81 | 1000 | 1000 | 1000 | directly |
| 16235 | VIERU | MDA | sen-m-66 | 995 | 995 | 995 | directly |
| 17835 | CARGNIN | BRA | sen-m-73 | 986 | 986 | 986 | directly |
| 47189 | YONEZUKA | USA | sen-m-73 | 966 | 966 | 966 | home nation |
| 85868 | MAKHMADBEKOV | UAE | sen-m-73 | 960 | 960 | 880 | directly |
| 67289 | ASHPIZ | ISR | sen-m-60 | 943 | 943 | 763 | directly |
| 94520 | LYTVYNENKO | UAE | sen-f-78 | 2350 | 2350 | 1850 | directly |
| 13713 | HERSHKO | ISR | sen-f+78 | 1746 | 1746 | 1396 | directly |
| 42127 | OLEK | GER | sen-f-78 | 1530 | 1530 | 1530 | directly |
| 31757 | KOGA | JPN | sen-f-48 | 1500 | 1500 | 1500 | directly |
| 35696 | ABE | JPN | sen-f-52 | 1500 | 1500 | 1500 | directly |
| 66481 | OMORI | JPN | sen-f-57 | 1500 | 1500 | 1500 | directly |
| 87228 | KAJU | JPN | sen-f-63 | 1500 | 1500 | 1500 | directly |
| 30629 | DICKO | FRA | sen-f+78 | 1400 | 1400 | 1400 | directly |
| 19039 | VUKOVIC | CRO | sen-f+78 | 1395 | 1395 | 895 | directly |
| 31266 | VOROBEVA | RUS | sen-f-48 | 1316 | 1316 | 1066 | directly |
| 20253 | LIPARTELIANI | GEO | sen-f-57 | 1200 | 1200 | 1200 | directly |
| 82119 | LEIVA SANCHEZ | ESP | sen-f-52 | 1180 | 1180 | 1180 | directly |
| 36429 | SCUTTO | ITA | sen-f-48 | 1130 | 1130 | 1130 | directly |
| 50041 | TORO SOLER | ESP | sen-f-52 | 1130 | 1130 | 1130 | directly (nation) |
| 41951 | TAVANO | ITA | sen-f+78 | 1105 | 1105 | 855 | directly |
| 3469 | GIUFFRIDA | ITA | sen-f-52 | 1100 | 1100 | 1100 | directly |
| 14920 | GILIAZOVA | RUS | sen-f-48 | 1085 | 1085 | 1085 | directly (nation) |
| 18530 | SZYMANSKA | POL | sen-f-63 | 1066 | 1066 | 566 | directly |
| 25334 | CYSIQUE | FRA | sen-f-57 | 1060 | 1060 | 1060 | directly |
| 60920 | PRIMO | ISR | sen-f-63 | 1038 | 1038 | 1038 | directly |
| 20206 | PRIMO | ISR | sen-f-52 | 1026 | 1026 | 776 | directly |
| 20102 | BUTKEREIT | GER | sen-f-70 | 1015 | 1015 | 1015 | directly |
| 13682 | POLLERES | AUT | sen-f-70 | 1011 | 1011 | 1011 | directly |
| 51204 | TSUNODA ROUSTANT | ESP | sen-f-70 | 1010 | 1010 | 1010 | directly |

## What this means for the build

- `src/engine/rules/la28.ts`: window, the 50%/100% year split and the quotas; `src/engine/olympic.ts`:
  `olympicPoints` = the senior `computeRanking` over window competitions with the Olympic period rule (no
  second counting implementation).
- Official Olympic data for the site comes from `competitor.wrl_current` (all athletes, but lagging) with its own
  list date chosen by best engine match; the page's top 48 is used as a second check in `validation.json`.
- Statuses compare against `q_status` (1 direct, 2 continental, 3 NOC-blocked, 4 host). First nightly run
  (2026-11-14, allocation on the official points of the 2026-10-12 list): 618/619 agree (99.84%; direct 238/238,
  NOC-blocked 73/73, continental 69/69, host 12/12, out 226/227). Host-nation rule confirmed: every USA athlete is
  status 4 and exactly 14 × 17 = 238 athletes are status 1, so USA athletes in a top 17 take no direct place.
