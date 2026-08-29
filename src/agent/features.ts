/**
 * Which parts of the workflow are switched on.
 *
 * The workflow adds four things to the baseline at once. Reporting that as a
 * single number would say "it is better" without saying which part did the
 * work, which is exactly what the improvement changelog is supposed to answer.
 * Each feature can therefore be disabled independently and measured as its own
 * variant:
 *
 *   AGENT_FEATURES=triage,search,verify   task project:agent   # full
 *   AGENT_FEATURES=search,verify          ...                  # no triage
 *   AGENT_FEATURES=triage,verify          ...                  # no search
 *   AGENT_FEATURES=triage,search          ...                  # no verifier
 *
 * Ranked metric movement is not switchable: it is part of how a bundle is
 * presented at every step, so removing it would change the baseline comparison
 * rather than ablate a workflow feature.
 */

export type Feature = 'triage' | 'search' | 'verify';

const ALL: Feature[] = ['triage', 'search', 'verify'];

/**
 * Fixed searches used when triage is disabled.
 *
 * Deliberately generic: this is what someone would grep for without having
 * looked at the incident first, which is the point of the ablation.
 */
export const DEFAULT_QUERIES = ['error', 'warn', 'timeout', 'failed'];

export function enabledFeatures(): Set<Feature> {
  const raw = process.env.AGENT_FEATURES;
  if (!raw) return new Set(ALL);
  const names = raw
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  for (const name of names) {
    if (!ALL.includes(name as Feature)) {
      throw new Error(`unknown feature "${name}", expected some of ${ALL.join(', ')}`);
    }
  }
  return new Set(names as Feature[]);
}
