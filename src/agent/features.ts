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
 *   AGENT_FEATURES=triage,search,verify   ...                  # no memory
 *
 * Ranked metric movement is not switchable: it is part of how a bundle is
 * presented at every step, so removing it would change the baseline comparison
 * rather than ablate a workflow feature.
 */

export type Feature = 'triage' | 'search' | 'verify' | 'memory';

const ALL: Feature[] = ['triage', 'search', 'verify', 'memory'];

/**
 * The shipped configuration. Note what is missing: triage.
 *
 * Removing the triage pass beat keeping it on pass rate (0.667 vs 0.611) and on
 * cause accuracy (0.917 vs 0.861), identically across all three repeats. It
 * commits to an onset and a framing before any log line has been read, and the
 * draft then reasons from that frame rather than from the evidence. Generic
 * queries retrieve less precisely but carry no such prior.
 *
 * It stays implementable and switchable so the result can be reproduced:
 *   AGENT_FEATURES=triage,search,verify,memory
 */
const DEFAULT: Feature[] = ['search', 'verify', 'memory'];

/**
 * Fixed searches used when triage is disabled.
 *
 * Deliberately generic: this is what someone would grep for without having
 * looked at the incident first, which is the point of the ablation.
 */
export const DEFAULT_QUERIES = ['error', 'warn', 'timeout', 'failed'];

export function enabledFeatures(): Set<Feature> {
  const raw = process.env.AGENT_FEATURES;
  if (!raw) return new Set(DEFAULT);
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
