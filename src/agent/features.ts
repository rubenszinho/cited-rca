/**
 * Which parts of the workflow are switched on.
 *
 * The workflow adds four things to the baseline at once. Reporting that as a
 * single number would say "it is better" without saying which part did the
 * work, which is exactly what the improvement changelog is supposed to answer.
 * Each feature can therefore be disabled independently and measured as its own
 * variant:
 *
 *   AGENT_FEATURES=search,verify             # shipped
 *   AGENT_FEATURES=verify                    # agent-nosearch
 *   AGENT_FEATURES=search                    # agent-noverify
 *   AGENT_FEATURES=triage,search,verify      # agent-withtriage
 *   AGENT_FEATURES=search,verify,memory      # agent-memory
 *   AGENT_FEATURES=search,investigate,verify # agent-investigate
 *
 * `task project:ablate` runs exactly these, six seeds each. Every figure below
 * is a mean over that grid; the comparisons are committed under
 * results/paired/ and the numbers here are checked against them by
 * `task project:verify:claims`.
 *
 * Ranked metric movement is not switchable: it is part of how a bundle is
 * presented at every step, so removing it would change the baseline comparison
 * rather than ablate a workflow feature.
 */

export type Feature = 'triage' | 'search' | 'investigate' | 'verify' | 'memory';

const ALL: Feature[] = ['triage', 'search', 'investigate', 'verify', 'memory'];

/**
 * The shipped configuration. Three of the five features are deliberately off.
 *
 * All three were rejected on the primary metric, named before any of this ran.
 * Two of them rank *above* the shipped workflow on it, and the honest reason
 * they stay out is that neither margin survives being paired seed by seed
 * against the same runs.
 *
 * `triage` is the closest call and the uncomfortable one. It leads on pass rate
 * (0.181 against 0.153) and ties on cause accuracy (0.926 against 0.923), and
 * it grounds markedly better - 0.627 against 0.413, the best in the grid.
 * Paired on the same six seeds the lead is +0.028 with a spread of 0.126: it
 * wins four seeds and loses two, and the mean is a fifth of its own noise. It
 * is out because the lead is indistinguishable from chance, not because it was
 * shown to be worse. An earlier three-seed run had it losing on both metrics;
 * that reversed under six seeds and the stricter grounding check, and saying so
 * is the point of keeping this file honest.
 *
 * `memory` also leads on pass rate (0.194 against 0.153, paired +0.042 with a
 * spread of 0.087) and is clearly worse at the two things it was supposed to
 * help: the worst cause accuracy of any variant that keeps search (0.867
 * against 0.923) and the most red herrings in the grid (0.414 against 0.242).
 * Recalling "these signals mean DNS" made it reach for the DNS-shaped change
 * event on case 10 - a mitigation applied 28 minutes after onset - and cite it
 * as supporting evidence. It became more confident and less careful about what
 * supports a claim.
 *
 * `investigate` - an iterative search loop - is the clearest loss and the only
 * one that needs no statistical argument. It halves the pass rate (0.083
 * against 0.153) and posts the lowest cause accuracy in the grid (0.801 against
 * 0.923) with more red herrings (0.331 against 0.242), at 2.4x the model calls
 * and 2.0x the cost. More turns to reason in are also more turns to fail in.
 *
 * Promoting a secondary metric after seeing the results is how an evaluation
 * stops meaning anything, so triage stays out on the primary metric despite
 * owning the grounding number - and the changelog argues its case rather than
 * burying it.
 *
 * All three stay implemented and switchable so every rejection can be
 * reproduced from the committed cassettes, with no key and no spend.
 */
const DEFAULT: Feature[] = ['search', 'verify'];

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
