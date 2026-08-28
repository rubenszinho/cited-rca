/**
 * Change and alert emission.
 *
 * Both are small hand-placed lists rather than generated streams, because their
 * position in the timeline is the whole point: a deploy two minutes before
 * onset is the red herring, and the alert that fired is what the on-call
 * actually saw first.
 */
import type { AlertEvent, ChangeEvent } from '../model.ts';
import type { TimedAlert, TimedChange } from './spec.ts';
import { atMinute, chronological } from './timeline.ts';

export function emitChanges(changes: TimedChange[]): ChangeEvent[] {
  return chronological(
    changes.map(({ minute, ...rest }) => ({ ts: atMinute(minute, 0), ...rest })),
  );
}

export function emitAlerts(alerts: TimedAlert[]): AlertEvent[] {
  return chronological(
    alerts.map(({ minute, ...rest }) => ({ ts: atMinute(minute, 0), ...rest })),
  );
}
