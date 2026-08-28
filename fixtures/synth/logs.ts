/**
 * Log line emission.
 *
 * Steady chatter across the whole window, plus the fault signature from onset
 * onward. The chatter matters: an RCA workflow that only ever sees error lines
 * is not being asked to find anything. Roughly 2k lines per case is enough to
 * punish a naive "paste the whole log into the prompt" approach.
 */
import type { LogLine } from '../model.ts';
import type { Random } from '../rng.ts';
import type { LogSpec, LogTemplate } from './spec.ts';
import { atMinute, chronological } from './timeline.ts';

function render(template: LogTemplate, ts: string, rand: Random): LogLine {
  const fields = { ...(template.fields ?? {}) };
  // Placeholders let one template stand in for a family of real lines.
  for (const [key, value] of Object.entries(fields)) {
    if (value === '$id') fields[key] = `req_${rand.int(100000, 999999)}`;
    if (value === '$ms') fields[key] = rand.int(5, 90);
  }
  return {
    ts,
    service: template.service,
    level: template.level,
    msg: template.msg,
    ...fields,
  };
}

function emitMinute(
  spec: LogSpec,
  minute: number,
  faulted: boolean,
  rand: Random,
): LogLine[] {
  const lines: LogLine[] = [];
  const chatter = rand.int(spec.normalRatePerMin - 3, spec.normalRatePerMin + 3);
  for (let i = 0; i < chatter; i++) {
    lines.push(render(rand.pick(spec.normal), atMinute(minute, rand.int(0, 59)), rand));
  }
  if (!faulted) return lines;
  for (const template of spec.onFault) {
    for (let i = 0; i < template.ratePerMin; i++) {
      lines.push(render(template, atMinute(minute, rand.int(0, 59)), rand));
    }
  }
  return lines;
}

export function emitLogs(
  spec: LogSpec,
  window: { minutes: number; onset: number },
  rand: Random,
): LogLine[] {
  const lines: LogLine[] = [];
  for (let minute = 0; minute < window.minutes; minute++) {
    lines.push(...emitMinute(spec, minute, minute >= window.onset, rand));
  }
  return chronological(lines);
}

export function toJsonl(records: object[]): string {
  return records.map((r) => JSON.stringify(r)).join('\n') + '\n';
}
