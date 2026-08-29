/**
 * What the workflow can do to a bundle without spending a token.
 *
 * Both tools exist to move work out of the model. The baseline reads sixty rows
 * of CSV per series and has to notice which one moved; here that comparison is
 * arithmetic, done in code, and the model receives the conclusion. Likewise the
 * baseline gets one fixed slice of the log, while the workflow can ask for the
 * lines it actually wants.
 */
import { addressed, findFileOrThrow } from '../context.ts';
import type { IncidentBundle } from '../bundle.ts';

export type SeriesMove = {
  series: string;
  source: string;
  first: number;
  last: number;
  min: number;
  max: number;
  /** Percent change from the first sample to the largest excursion. */
  swing_pct: number;
};

function swing(first: number, min: number, max: number): number {
  if (first === 0) return max === 0 ? 0 : 100;
  const excursion = Math.abs(max - first) >= Math.abs(first - min) ? max : min;
  return Number((((excursion - first) / Math.abs(first)) * 100).toFixed(1));
}

function summariseColumn(source: string, name: string, values: number[]): SeriesMove {
  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? 0;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return {
    series: name,
    source,
    first,
    last,
    min,
    max,
    swing_pct: swing(first, min, max),
  };
}

/**
 * Every metric series, ranked by how far it moved.
 *
 * Ranking matters more than the numbers: it puts the series that actually
 * changed in front of the model and demotes the flat control series, which is
 * the reasoning step the baseline has to perform for itself.
 */
export function metricMoves(bundle: IncidentBundle): SeriesMove[] {
  const moves: SeriesMove[] = [];
  for (const file of bundle.files.filter((f) => f.source.startsWith('metrics/'))) {
    const [header, ...rows] = file.lines;
    const columns = (header ?? '').split(',');
    for (let col = 1; col < columns.length; col++) {
      const values = rows.map((row) => Number(row.split(',')[col] ?? 0));
      moves.push(summariseColumn(file.source, columns[col] ?? `col${col}`, values));
    }
  }
  return moves.sort((a, b) => Math.abs(b.swing_pct) - Math.abs(a.swing_pct));
}

export type SearchHit = { line: string };

/**
 * Substring search over the log, returning addressed lines.
 *
 * Results carry their real addresses, so anything the model cites from a search
 * result is citable by construction. Matches are spread across the file rather
 * than taken from the front: a fault emits its signature hundreds of times, and
 * the first `limit` of them all come from the same minute.
 */
export function searchLog(
  bundle: IncidentBundle,
  query: string,
  limit: number,
): string[] {
  const file = findFileOrThrow(bundle, 'logs/app.jsonl');
  const needle = query.toLowerCase();
  const hits: number[] = [];
  file.lines.forEach((line, index) => {
    if (line.toLowerCase().includes(needle)) hits.push(index);
  });
  if (hits.length <= limit) return hits.map((index) => addressed(file, index));

  const step = hits.length / limit;
  const spread = Array.from(
    { length: limit },
    (_, n) => hits[Math.floor(n * step)] ?? 0,
  );
  return [
    ...spread.map((index) => addressed(file, index)),
    `# ${hits.length} lines match "${query}"; ${limit} shown, spread across the window`,
  ];
}
