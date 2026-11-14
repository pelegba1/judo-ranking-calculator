// Records raw IJF API responses / pages into tests/fixtures. Network only here.
// Note: competitions/partial-3159 is a hand-saved snapshot of a running event and is never touched.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  apiGet,
  getCompetitionInfo,
  getContests,
  getCompetitors,
  getResults,
} from '../src/data/ijf-api';

const FIX = join(import.meta.dirname, '..', 'tests', 'fixtures');
const COMPETITIONS = [3157, 3151, 3191];
const BREAKDOWNS = [20144, 75902, 97658];

async function save(path: string, data: unknown) {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, typeof data === 'string' ? data : JSON.stringify(data));
  console.log('wrote', path);
}

async function recordCompetition(id: number) {
  const dir = join(FIX, 'competitions', String(id));
  await save(join(dir, 'info.json'), await getCompetitionInfo(id));
  await save(join(dir, 'contests.json'), { contests: await getContests(id) });
  await save(join(dir, 'competitors.json'), await getCompetitors(id));
  await save(join(dir, 'results.json'), await getResults(id));
}

/** Scan ids near 3191 for a junior event (code contains _jun) that has results. */
async function findJunior(): Promise<number> {
  for (let id = 3150; id <= 3330; id++) {
    const info = await getCompetitionInfo(id);
    if (!info || !/_jun/.test(info.competition_code)) continue;
    const r = await getResults(id).catch(() => null);
    if (r && Object.keys(r.by_categories ?? {}).length > 0) {
      console.log('junior competition', id, info.competition_code);
      return id;
    }
  }
  throw new Error('no junior competition found');
}

async function main() {
  for (const id of COMPETITIONS) await recordCompetition(id);
  await recordCompetition(await findJunior());
  await save(join(FIX, 'ranking.json'), await apiGet('ranking.get_list', { limit: 20000 }));
  for (const id of BREAKDOWNS) {
    const res = await fetch(`https://www.ijf.org/judoka/${id}/wrl`); // follows redirects
    if (!res.ok) throw new Error(`breakdown ${id}: HTTP ${res.status}`);
    await save(join(FIX, 'breakdown', `${id}.html`), await res.text());
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
