import type { AgeGroup } from '../engine/types';

export interface BreakdownRow {
  date: string; // ISO yyyy-mm-dd
  placeLabel: string;
  competitionName: string;
  competitionCode: string | null;
  points: number;
  percent: 100 | 50;
}

export interface BreakdownPage {
  rankedOn: string; // ISO yyyy-mm-dd
  age: AgeGroup;
  rows: BreakdownRow[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

function isoFromText(text: string): string {
  const m = /([A-Z][a-z]{2})[a-z]*\.? (\d{1,2}), (\d{4})/.exec(text);
  const mi = m ? MONTHS.indexOf(m[1]) : -1;
  if (!m || mi < 0) throw new Error(`Unparseable date: ${text}`);
  return `${m[3]}-${String(mi + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

/** Competition name -> externalId from the Nuxt devalue payload (flat array with index refs). */
function externalIds(html: string): Map<string, string> {
  const out = new Map<string, string>();
  const m = /<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) return out;
  let arr: unknown[];
  try {
    arr = JSON.parse(m[1]) as unknown[];
  } catch {
    return out;
  }
  for (const v of arr) {
    if (v && typeof v === 'object' && !Array.isArray(v) && 'externalId' in v && 'name' in v) {
      const o = v as Record<string, number>;
      const name = arr[o.name];
      const code = arr[o.externalId];
      if (typeof name === 'string' && typeof code === 'string' && !out.has(name)) out.set(name, code);
    }
  }
  return out;
}

const AGES: Record<string, AgeGroup> = { Seniors: 'sen', Juniors: 'jun', Cadets: 'cad' };

export function parseBreakdownPage(html: string): BreakdownPage {
  const codes = externalIds(html);
  const body = html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '');

  const ranked = /Ranked on ([A-Z][a-z]{2} \d{1,2}, \d{4})/.exec(body);
  if (!ranked) throw new Error('Breakdown page: "Ranked on" not found');
  const rankedOn = isoFromText(ranked[1]);

  const ageM = /data-slot="label"[^>]*>(Seniors|Juniors|Cadets)</.exec(body.slice(ranked.index));
  if (!ageM) throw new Error('Breakdown page: age label not found');

  const rowRe =
    /<span class="order-1[^>]*>([^<]*)<\/span><span class="order-2[^>]*>([^<]*)<\/span><span class="order-3[^>]*>([^<]*)<\/span><span class="order-4[^>]*>[^<]*<\/span><span class="order-5[^>]*>\s*(\d+)\s*\((\d+)%\)/g;
  const rows: BreakdownRow[] = [];
  for (const m of body.matchAll(rowRe)) {
    const percent = Number(m[5]);
    if (percent !== 100 && percent !== 50) throw new Error(`Unexpected percent ${percent}`);
    const competitionName = decode(m[3].trim());
    rows.push({
      date: isoFromText(m[1]),
      placeLabel: decode(m[2].trim()),
      competitionName,
      competitionCode: codes.get(competitionName) ?? null,
      points: Number(m[4]),
      percent,
    });
  }
  return { rankedOn, age: AGES[ageM[1]], rows };
}
