/**
 * What the workflow carries forward between incidents.
 *
 * An on-call engineer who has seen the same system fail ten times does not
 * start each review from nothing. They remember that when the pool's idle
 * count drains while database CPU stays flat, the caller is holding
 * connections. That recall is the thing this adds.
 *
 * Two constraints make it honest:
 *
 * 1. It never stores ground truth. It stores what the workflow itself
 *    concluded. If an earlier conclusion was wrong, the wrong lesson is
 *    carried forward - which is exactly what happens to a real engineer, and
 *    the evaluation is free to show it costs more than it gains.
 *
 * 2. It accumulates in case order within a run. The first incident has no
 *    memory; the twelfth has eleven priors. Nothing is pre-seeded, so the
 *    benefit has to be earned during the run rather than smuggled in.
 */
import type { RootCause } from '../../fixtures/model.ts';
import type { IncidentBundle } from '../bundle.ts';
import { metricMoves } from './tools.ts';

/** One remembered incident: the signals that were present, and the verdict. */
export type Recollection = {
  caseId: string;
  concluded: RootCause;
  signals: string[];
};

/** Series that moved enough to be worth remembering, as `file:series`. */
const MOVED_PCT = 50;

/** How many priors are surfaced. More becomes noise the draft has to filter. */
const RECALL_LIMIT = 2;

export function signalsOf(bundle: IncidentBundle): string[] {
  return metricMoves(bundle)
    .filter((move) => Math.abs(move.swing_pct) >= MOVED_PCT)
    .slice(0, 4)
    .map((move) => `${move.series} ${move.swing_pct > 0 ? 'rose' : 'fell'}`);
}

export class IncidentMemory {
  private seen: Recollection[] = [];

  remember(bundle: IncidentBundle, concluded: RootCause): void {
    this.seen.push({ caseId: bundle.caseId, concluded, signals: signalsOf(bundle) });
  }

  /** Priors sharing the most signals with this incident, best first. */
  recall(bundle: IncidentBundle): Recollection[] {
    const now = new Set(signalsOf(bundle));
    return this.seen
      .map((prior) => ({
        prior,
        overlap: prior.signals.filter((signal) => now.has(signal)).length,
      }))
      .filter(({ overlap }) => overlap > 0)
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, RECALL_LIMIT)
      .map(({ prior }) => prior);
  }

  size(): number {
    return this.seen.length;
  }
}

/**
 * Rendered for the draft prompt.
 *
 * Deliberately hedged. These are the workflow's own past conclusions, not
 * facts, and a prompt that presents them as facts would turn one early mistake
 * into eleven.
 */
export function renderRecall(priors: Recollection[]): string {
  if (priors.length === 0) return '';
  const lines = priors.map(
    (prior) =>
      `- when ${prior.signals.join(' and ')}, the cause was ${prior.concluded} (${prior.caseId})`,
  );
  return [
    '--- what you concluded on earlier incidents with similar signals ---',
    ...lines,
    'These are your own past conclusions on this system, not established facts.',
    'They are a place to look first, not an answer. Say so if the evidence here',
    'points elsewhere.',
  ].join('\n');
}
