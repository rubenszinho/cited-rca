/**
 * Rendering a bundle into prompt text.
 *
 * Every line carries its real address as `source:line| text`. That is what
 * makes citation possible at all: the model can only cite a line it can name,
 * and the grader resolves those names back against the bundle. Renumbering or
 * dropping the prefix would make every citation unverifiable.
 *
 * A whole bundle is roughly 300 KB, so nothing sends all of it. What differs
 * between the baseline and the workflow is *how* the budget is spent, and that
 * difference is the experiment.
 */
import type { BundleFile, IncidentBundle } from './bundle.ts';

/** One addressable line, as the model sees it. */
export function addressed(file: BundleFile, index: number): string {
  return `${file.source}:${index + 1}| ${file.lines[index]}`;
}

export function renderFile(file: BundleFile): string {
  return file.lines.map((_, index) => addressed(file, index)).join('\n');
}

/** Lines whose JSON payload carries one of the given levels. */
export function linesAtLevel(file: BundleFile, levels: string[]): string[] {
  const wanted = levels.map((level) => `"level":"${level}"`);
  return file.lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => wanted.some((needle) => line.includes(needle)))
    .map(({ index }) => addressed(file, index));
}

/**
 * Distinct log shapes, keeping the first few occurrences of each.
 *
 * A fault emits the same line hundreds of times. Pasting all of them is not
 * what an engineer does and would make the baseline a strawman that loses on
 * context budget rather than on reasoning. Keeping the first occurrences
 * preserves citability - those line numbers are real - and the count carries
 * the magnitude the repetition was standing in for.
 */
/**
 * The message a log line carries, used to collapse repeats of the same fault.
 *
 * Parses rather than pattern-matches: a JSON log line already knows what its
 * message is, and reading the field is both exact and immune to a message that
 * happens to contain the delimiter.
 */
function messageShape(line: string): string {
  try {
    const parsed: unknown = JSON.parse(line);
    const msg = (parsed as { msg?: unknown }).msg;
    if (typeof msg === 'string') return msg;
  } catch {
    // Not a JSON line (a CSV row, a comment). Fall back to a prefix.
  }
  return line.slice(0, 60);
}

function groupByShape(file: BundleFile, levels: string[]): Map<string, number[]> {
  const shapes = new Map<string, number[]>();
  file.lines.forEach((line, index) => {
    if (!levels.some((level) => line.includes(`"level":"${level}"`))) return;
    const shape = messageShape(line);
    shapes.set(shape, [...(shapes.get(shape) ?? []), index]);
  });
  return shapes;
}

export function deduped(
  file: BundleFile,
  levels: string[],
  keepPerShape: number,
): string[] {
  const out: string[] = [];
  for (const [shape, indexes] of groupByShape(file, levels)) {
    for (const index of indexes.slice(0, keepPerShape))
      out.push(addressed(file, index));
    if (indexes.length > keepPerShape) {
      out.push(`# ${indexes.length} lines total matching "${shape}"`);
    }
  }
  return out;
}

/** Evenly spaced sample, so a truncated view still spans the whole window. */
export function sample(file: BundleFile, count: number): string[] {
  if (file.lines.length <= count) return file.lines.map((_, i) => addressed(file, i));
  const step = file.lines.length / count;
  return Array.from({ length: count }, (_, n) => addressed(file, Math.floor(n * step)));
}

export function findFileOrThrow(bundle: IncidentBundle, source: string): BundleFile {
  const file = bundle.files.find((candidate) => candidate.source === source);
  if (!file) throw new Error(`bundle ${bundle.caseId} has no file ${source}`);
  return file;
}

/** Everything that is small enough to always include in full. */
export function smallSources(bundle: IncidentBundle): string[] {
  return bundle.files
    .filter((file) => file.source !== 'logs/app.jsonl')
    .map((file) => `--- ${file.source} ---\n${renderFile(file)}`);
}
