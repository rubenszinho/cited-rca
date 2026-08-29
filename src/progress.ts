/**
 * Optional narration of what the workflow is doing.
 *
 * Off by default. The evaluation runs twelve cases across several variants and
 * needs its stderr for pass/fail lines; a single interactive run wants the
 * opposite, because a workflow that sits silent for forty seconds and then
 * prints a wall of text gives no sense of having done anything.
 *
 * Everything here writes to stderr and touches no prompt. Prompt text is part
 * of a cassette key, so narration that leaked into a message would invalidate
 * every recorded run - which has happened once already, from one reworded line.
 */
export type Reporter = (line: string) => void;

const silent: Reporter = () => {};
let reporter: Reporter = silent;

/** Install a reporter for the current process. */
export function enableProgress(report: Reporter = (line) => console.error(line)): void {
  reporter = report;
}

export function progress(line: string): void {
  reporter(line);
}

/** Indented detail under the current step. */
export function detail(line: string): void {
  reporter(`    ${line}`);
}
