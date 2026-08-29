/**
 * Faults that originate outside the system, and one that only looks external.
 *
 * Case 12 is the hard case. Everything about it invites blaming the deploy that
 * landed two minutes before onset; the actual trigger is a scheduled batch job
 * saturating the same database. A workflow that has learned "correlate the
 * change timeline" from the first eleven cases fails this one, which is exactly
 * what it is there to measure.
 */
import type { Scenario } from '../synth/spec.ts';
import { CHATTER, latencyMetric } from './common.ts';

export const EXTERNAL_SCENARIOS: Scenario[] = [
  {
    id: '09-downstream-timeout',
    title: 'Inventory lookups hanging against the supplier API',
    rootCause: 'downstream_dependency_failure',
    summary:
      'The supplier inventory API degraded to multi-second responses; calls had no ' +
      'timeout, so request threads accumulated waiting on it.',
    windowMinutes: 60,
    onsetMinute: 19,
    detectMinute: 26,
    logs: {
      normalRatePerMin: 26,
      normal: CHATTER,
      onFault: [
        {
          service: 'api',
          level: 'warn',
          msg: 'downstream call slow',
          ratePerMin: 11,
          fields: { peer: 'supplier-inventory', ms: 8400 },
        },
        {
          service: 'api',
          level: 'error',
          msg: 'context deadline exceeded calling supplier-inventory',
          ratePerMin: 5,
          fields: { req: '$id' },
        },
      ],
    },
    metrics: [
      latencyMetric(8.1, 21),
      {
        name: 'downstream',
        series: [
          {
            name: 'supplier_p95_ms',
            base: 210,
            noisePct: 0.12,
            after: { shape: 'step', factor: 41 },
            precision: 0,
          },
          {
            name: 'supplier_error_rate',
            base: 0.001,
            noisePct: 0.5,
            after: { shape: 'ramp', factor: 88 },
            precision: 4,
          },
          {
            name: 'inflight_requests',
            base: 34,
            noisePct: 0.12,
            after: { shape: 'ramp', factor: 9 },
            precision: 0,
          },
        ],
      },
    ],
    changes: [
      {
        minute: 3,
        kind: 'deploy',
        ref: 'v2026.3.17-g2',
        actor: 'ci-bot',
        summary: 'api: copy tweaks on the product page',
      },
    ],
    alerts: [
      { minute: 26, name: 'ApiLatencyP95', severity: 'page', state: 'firing' },
      { minute: 30, name: 'InflightRequestsHigh', severity: 'ticket', state: 'firing' },
    ],
    requiredEvidence: [
      {
        source: 'logs/app.jsonl',
        match: 'supplier-inventory',
        why: 'the failing peer, named in the log line',
      },
      {
        source: 'metrics/downstream.csv',
        match: '$onset',
        why: 'the supplier_p95_ms series at onset, the step change is on the supplier side, not ours',
      },
      {
        source: 'metrics/downstream.csv',
        match: '$onset',
        why: 'the inflight_requests series at onset, requests piling up because the calls have no timeout',
      },
    ],
    redHerrings: [
      {
        source: 'changes.jsonl',
        match: 'v2026.3.17-g2',
        why_tempting:
          'the only deploy in the window, 16 minutes before onset and unrelated',
      },
    ],
  },
  {
    id: '10-dns-failure',
    title: 'Intermittent resolution failures across every service',
    rootCause: 'dns_failure',
    summary:
      'One of the two cluster DNS pods was serving SERVFAIL, so roughly half of all ' +
      'resolutions failed regardless of which service or peer was involved.',
    windowMinutes: 60,
    onsetMinute: 16,
    detectMinute: 21,
    logs: {
      normalRatePerMin: 28,
      normal: CHATTER,
      onFault: [
        {
          service: 'api',
          level: 'error',
          msg: 'dial tcp: lookup payments.internal: SERVFAIL',
          ratePerMin: 6,
          fields: { req: '$id' },
        },
        {
          service: 'worker',
          level: 'error',
          msg: 'dial tcp: lookup queue.internal: SERVFAIL',
          ratePerMin: 5,
          fields: { job: '$id' },
        },
        {
          service: 'checkout',
          level: 'error',
          msg: 'dial tcp: lookup db-proxy.internal: SERVFAIL',
          ratePerMin: 4,
          fields: { req: '$id' },
        },
      ],
    },
    metrics: [
      latencyMetric(2.4, 28),
      {
        name: 'dns',
        series: [
          {
            name: 'servfail_per_min',
            base: 0,
            noisePct: 0,
            after: { shape: 'step', factor: 1 },
            precision: 0,
          },
          {
            name: 'resolve_p95_ms',
            base: 4,
            noisePct: 0.2,
            after: { shape: 'step', factor: 620 },
            precision: 0,
          },
        ],
      },
    ],
    changes: [
      {
        minute: 44,
        kind: 'scale',
        ref: 'coredns',
        actor: 'sre-oncall',
        summary: 'coredns replicas 2 -> 4 (mitigation)',
      },
    ],
    alerts: [
      { minute: 21, name: 'MultiServiceErrorSpike', severity: 'page', state: 'firing' },
      { minute: 23, name: 'DnsResolveLatency', severity: 'page', state: 'firing' },
    ],
    requiredEvidence: [
      {
        source: 'logs/app.jsonl',
        match: 'SERVFAIL',
        why: 'the resolution failure itself',
      },
      {
        source: 'metrics/dns.csv',
        match: '$onset',
        why: 'the resolve_p95_ms series at onset, resolution latency stepping up',
      },
      {
        source: 'alerts.jsonl',
        match: 'MultiServiceErrorSpike',
        why: 'three unrelated services failing at once points below the application layer',
      },
    ],
    redHerrings: [
      {
        source: 'changes.jsonl',
        match: 'coredns replicas 2 -> 4',
        why_tempting:
          'a DNS change in the window, but 28 minutes after onset and a mitigation',
      },
    ],
  },
  {
    id: '11-upstream-rate-limit',
    title: 'Payment authorisations rejected in bursts',
    rootCause: 'upstream_rate_limit',
    summary:
      'A retry storm from an earlier blip pushed call volume past the payment ' +
      "provider's 600/min quota, so the provider returned 429 for the excess.",
    windowMinutes: 60,
    onsetMinute: 28,
    detectMinute: 31,
    logs: {
      normalRatePerMin: 27,
      normal: CHATTER,
      onFault: [
        {
          service: 'checkout',
          level: 'error',
          msg: 'payment provider returned 429',
          ratePerMin: 9,
          fields: { status: 429, retry_after_s: 30, quota: '600/min' },
        },
        {
          service: 'checkout',
          level: 'warn',
          msg: 'retrying authorisation',
          ratePerMin: 12,
          fields: { req: '$id', attempt: 4 },
        },
      ],
    },
    metrics: [
      latencyMetric(2.2, 24),
      {
        name: 'payments',
        series: [
          {
            name: 'calls_per_min',
            base: 430,
            noisePct: 0.08,
            after: { shape: 'step', factor: 2.1 },
            precision: 0,
          },
          {
            name: 'rejected_429_per_min',
            base: 0,
            noisePct: 0,
            after: { shape: 'step', factor: 1 },
            precision: 0,
          },
          {
            name: 'authorised_per_min',
            base: 402,
            noisePct: 0.08,
            after: { shape: 'drain', factor: 2.8 },
            precision: 0,
          },
        ],
      },
    ],
    changes: [
      {
        minute: 12,
        kind: 'deploy',
        ref: 'v2026.3.17-h5',
        actor: 'ci-bot',
        summary: 'checkout: raise retry attempts 2 -> 5',
      },
    ],
    alerts: [
      { minute: 31, name: 'PaymentAuthFailures', severity: 'page', state: 'firing' },
      {
        minute: 33,
        name: 'CheckoutConversionDrop',
        severity: 'ticket',
        state: 'firing',
      },
    ],
    requiredEvidence: [
      {
        source: 'logs/app.jsonl',
        match: 'returned 429',
        why: 'the provider rejecting on quota, with the quota named',
      },
      {
        source: 'metrics/payments.csv',
        match: '$onset',
        why: 'the calls_per_min series at onset, our call volume doubling, which is what crossed the quota',
      },
      {
        source: 'changes.jsonl',
        match: 'retry attempts 2 -> 5',
        why: 'the retry change that turned a blip into a storm',
      },
    ],
    redHerrings: [
      {
        source: 'alerts.jsonl',
        match: 'CheckoutConversionDrop',
        why_tempting:
          'reads as a checkout regression rather than an upstream rejecting our excess volume',
      },
    ],
  },
  {
    id: '12-batch-job-contention',
    title: 'Checkout degrades minutes after a routine release',
    rootCause: 'batch_job_contention',
    summary:
      'The nightly reconciliation job was rescheduled into business hours and took ' +
      'a long-held lock on the orders table. The release two minutes before onset ' +
      'was unrelated and touched no database path.',
    windowMinutes: 60,
    onsetMinute: 31,
    detectMinute: 35,
    logs: {
      normalRatePerMin: 30,
      normal: CHATTER,
      onFault: [
        {
          service: 'db-proxy',
          level: 'warn',
          msg: 'lock wait timeout on orders',
          ratePerMin: 10,
          fields: {
            blocking_pid: 8841,
            blocking_query: 'reconcile_orders_daily',
            waited_ms: 4800,
          },
        },
        {
          service: 'checkout',
          level: 'error',
          msg: 'transaction rolled back after lock wait',
          ratePerMin: 6,
          fields: { req: '$id' },
        },
      ],
    },
    metrics: [
      latencyMetric(5.6, 23),
      {
        name: 'db',
        series: [
          {
            name: 'lock_waits_per_min',
            base: 1,
            noisePct: 0.5,
            after: { shape: 'step', factor: 96 },
            precision: 0,
          },
          {
            name: 'longest_txn_s',
            base: 0.4,
            noisePct: 0.3,
            after: { shape: 'ramp', factor: 720 },
            precision: 1,
          },
          // Flat CPU rules out load: it is a lock, not saturation.
          {
            name: 'cpu_pct',
            base: 34,
            noisePct: 0.08,
            after: { shape: 'flat', factor: 1 },
            precision: 1,
          },
        ],
      },
    ],
    changes: [
      {
        minute: 29,
        kind: 'deploy',
        ref: 'v2026.3.17-j9',
        actor: 'ci-bot',
        summary: 'checkout: update footer links and analytics tag',
      },
      {
        minute: 30,
        kind: 'batch',
        ref: 'reconcile_orders_daily',
        actor: 'scheduler',
        summary: 'run rescheduled from 03:00 to 09:30 by change CR-4471',
      },
    ],
    alerts: [
      { minute: 35, name: 'CheckoutErrorRateHigh', severity: 'page', state: 'firing' },
      { minute: 36, name: 'DbLockWaits', severity: 'page', state: 'firing' },
    ],
    requiredEvidence: [
      {
        source: 'changes.jsonl',
        match: 'reconcile_orders_daily',
        why: 'the rescheduled batch job, one minute before onset',
      },
      {
        source: 'logs/app.jsonl',
        match: 'blocking_query',
        why: 'the blocking query named in the lock wait, which identifies the job directly',
      },
      {
        source: 'metrics/db.csv',
        match: '$onset',
        why: 'the lock_waits_per_min series at onset, lock waits rather than resource saturation',
      },
    ],
    redHerrings: [
      {
        source: 'changes.jsonl',
        match: 'v2026.3.17-j9',
        why_tempting:
          'a checkout deploy two minutes before onset, on the service that is failing - ' +
          'the single most tempting wrong answer in the set, and it touches no database path',
      },
    ],
  },
];
