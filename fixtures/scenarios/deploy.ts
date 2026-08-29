/**
 * Faults introduced by a change: code, config, schema, or an expiring artefact.
 *
 * These are the cases where the change timeline is genuinely the answer, which
 * is what makes case 12 (batch contention, where it is not) a fair trap rather
 * than a gotcha.
 */
import type { Scenario } from '../synth/spec.ts';
import { CHATTER, latencyMetric } from './common.ts';

export const DEPLOY_SCENARIOS: Scenario[] = [
  {
    id: '01-bad-deploy-null-deref',
    title: 'Checkout 500s after the 09:22 release',
    rootCause: 'bad_deploy_regression',
    summary:
      'Release v2026.3.17-a1 dereferenced an optional discount field that is absent ' +
      'for guest carts, so every guest checkout raised a TypeError.',
    windowMinutes: 60,
    onsetMinute: 23,
    detectMinute: 27,
    logs: {
      normalRatePerMin: 28,
      normal: CHATTER,
      onFault: [
        {
          service: 'checkout',
          level: 'error',
          msg: "TypeError: Cannot read properties of null (reading 'percentOff')",
          ratePerMin: 9,
          fields: { req: '$id', handler: 'applyDiscount', release: 'v2026.3.17-a1' },
        },
        {
          service: 'api',
          level: 'warn',
          msg: 'upstream checkout returned 500',
          ratePerMin: 6,
          fields: { req: '$id', status: 500 },
        },
      ],
    },
    metrics: [latencyMetric(2.1, 46)],
    changes: [
      {
        minute: 4,
        kind: 'deploy',
        ref: 'v2026.3.16-f3',
        actor: 'ci-bot',
        summary: 'checkout: bump logging library',
      },
      {
        minute: 22,
        kind: 'deploy',
        ref: 'v2026.3.17-a1',
        actor: 'ci-bot',
        summary: 'checkout: add tiered discount support',
      },
    ],
    alerts: [
      { minute: 27, name: 'CheckoutErrorRateHigh', severity: 'page', state: 'firing' },
      { minute: 31, name: 'ApiLatencyP95', severity: 'ticket', state: 'firing' },
    ],
    requiredEvidence: [
      {
        source: 'changes.jsonl',
        match: 'v2026.3.17-a1',
        why: 'the deploy that introduced the regression, one minute before onset',
      },
      {
        source: 'logs/app.jsonl',
        match: "reading 'percentOff'",
        why: 'the exception naming the field and handler',
      },
      {
        source: 'metrics/http.csv',
        match: '$onset',
        why: 'the error_rate series at onset, showing the step change in error rate',
      },
    ],
    redHerrings: [
      {
        source: 'changes.jsonl',
        match: 'v2026.3.16-f3',
        why_tempting:
          'an earlier deploy on the same service, but 19 minutes before onset',
      },
    ],
  },
  {
    id: '02-config-flag-misflip',
    title: 'Session loss after a feature flag rollout',
    rootCause: 'config_change',
    summary:
      'The flag strict_session_binding was rolled to 100% instead of the intended 5%, ' +
      'invalidating sessions issued before the rollout and logging users out mid-flow.',
    windowMinutes: 60,
    onsetMinute: 18,
    detectMinute: 24,
    logs: {
      normalRatePerMin: 30,
      normal: CHATTER,
      onFault: [
        {
          service: 'api',
          level: 'warn',
          msg: 'session binding mismatch, forcing re-auth',
          ratePerMin: 12,
          fields: { req: '$id', flag: 'strict_session_binding' },
        },
        {
          service: 'api',
          level: 'error',
          msg: 'request rejected: session invalid',
          ratePerMin: 7,
          fields: { req: '$id', status: 401 },
        },
      ],
    },
    metrics: [
      latencyMetric(1.15, 22),
      {
        name: 'auth',
        series: [
          {
            name: 'active_sessions',
            base: 8400,
            noisePct: 0.03,
            after: { shape: 'drain', factor: 5 },
            precision: 0,
          },
          {
            name: 'reauth_per_min',
            base: 12,
            noisePct: 0.3,
            after: { shape: 'step', factor: 31 },
            precision: 0,
          },
        ],
      },
    ],
    changes: [
      {
        minute: 17,
        kind: 'flag',
        ref: 'strict_session_binding',
        actor: 'rmartins',
        summary: 'rollout 5% -> 100% (intended 5%)',
      },
      {
        minute: 40,
        kind: 'scale',
        ref: 'api',
        actor: 'autoscaler',
        summary: 'api replicas 6 -> 9',
      },
    ],
    alerts: [
      { minute: 24, name: 'AuthReauthSpike', severity: 'page', state: 'firing' },
      { minute: 26, name: 'Api401RateHigh', severity: 'ticket', state: 'firing' },
    ],
    requiredEvidence: [
      {
        source: 'changes.jsonl',
        match: 'strict_session_binding',
        why: 'the flag flip one minute before onset, with the wrong percentage',
      },
      {
        source: 'logs/app.jsonl',
        match: 'session binding mismatch',
        why: 'the warning naming the flag',
      },
      {
        source: 'metrics/auth.csv',
        match: '$onset',
        why: 'the active_sessions series at onset, sessions draining rather than a traffic change',
      },
    ],
    redHerrings: [
      {
        source: 'changes.jsonl',
        match: 'api replicas 6 -> 9',
        why_tempting:
          'a scaling event during the incident, but a consequence of load, not the cause',
      },
    ],
  },
  {
    id: '03-schema-migration-index-drop',
    title: 'Order history times out after a migration',
    rootCause: 'schema_migration_regression',
    summary:
      'Migration 0142 dropped the composite index on orders(customer_id, created_at) ' +
      'while intending to replace it, leaving the history query on a sequential scan.',
    windowMinutes: 60,
    onsetMinute: 26,
    detectMinute: 33,
    logs: {
      normalRatePerMin: 26,
      normal: CHATTER,
      onFault: [
        {
          service: 'db-proxy',
          level: 'warn',
          msg: 'slow query',
          ratePerMin: 11,
          fields: { ms: 4200, table: 'orders', plan: 'Seq Scan on orders' },
        },
        {
          service: 'api',
          level: 'error',
          msg: 'statement timeout after 5000ms',
          ratePerMin: 5,
          fields: { req: '$id', route: '/orders/history' },
        },
      ],
    },
    metrics: [
      latencyMetric(9.4, 18),
      {
        name: 'db',
        series: [
          {
            name: 'mean_query_ms',
            base: 11,
            noisePct: 0.15,
            after: { shape: 'step', factor: 340 },
            precision: 1,
          },
          {
            name: 'seq_scans_per_min',
            base: 4,
            noisePct: 0.4,
            after: { shape: 'step', factor: 210 },
            precision: 0,
          },
          {
            name: 'cpu_pct',
            base: 31,
            noisePct: 0.1,
            after: { shape: 'ramp', factor: 2.7 },
            precision: 1,
          },
        ],
      },
    ],
    changes: [
      {
        minute: 25,
        kind: 'migration',
        ref: '0142_orders_index',
        actor: 'ci-bot',
        summary: 'drop idx_orders_customer_created; create idx_orders_customer',
      },
      {
        minute: 12,
        kind: 'deploy',
        ref: 'v2026.3.17-b4',
        actor: 'ci-bot',
        summary: 'api: unrelated copy change on the account page',
      },
    ],
    alerts: [
      { minute: 33, name: 'DbCpuHigh', severity: 'page', state: 'firing' },
      { minute: 35, name: 'ApiLatencyP95', severity: 'page', state: 'firing' },
    ],
    requiredEvidence: [
      {
        source: 'changes.jsonl',
        match: '0142_orders_index',
        why: 'the migration one minute before onset',
      },
      {
        source: 'logs/app.jsonl',
        match: 'Seq Scan on orders',
        why: 'the plan change proving the index is gone',
      },
      {
        source: 'metrics/db.csv',
        match: '$onset',
        why: 'the seq_scans_per_min series at onset, sequential scans jumping two orders of magnitude',
      },
    ],
    redHerrings: [
      {
        source: 'changes.jsonl',
        match: 'v2026.3.17-b4',
        why_tempting:
          'a deploy in the same window, but 14 minutes earlier and on an unrelated page',
      },
    ],
  },
  {
    id: '04-cert-expiry',
    title: 'Partner callbacks fail at the top of the hour',
    rootCause: 'certificate_expiry',
    summary:
      'The client certificate presented to the payments partner expired at 09:30Z; ' +
      'every outbound callback failed TLS handshake from that minute on.',
    windowMinutes: 60,
    onsetMinute: 30,
    detectMinute: 34,
    logs: {
      normalRatePerMin: 24,
      normal: CHATTER,
      onFault: [
        {
          service: 'worker',
          level: 'error',
          msg: 'tls: failed to verify certificate: certificate has expired',
          ratePerMin: 8,
          fields: {
            peer: 'payments.partner.example',
            notAfter: '2026-03-17T09:30:00Z',
          },
        },
        {
          service: 'worker',
          level: 'error',
          msg: 'callback delivery failed, scheduling retry',
          ratePerMin: 8,
          fields: { job: '$id', attempt: 3 },
        },
      ],
    },
    metrics: [
      latencyMetric(1.05, 3),
      {
        name: 'callbacks',
        series: [
          {
            name: 'delivered_per_min',
            base: 46,
            noisePct: 0.12,
            after: { shape: 'drain', factor: 46 },
            precision: 0,
          },
          {
            name: 'retry_queue_depth',
            base: 2,
            noisePct: 0.5,
            after: { shape: 'ramp', factor: 190 },
            precision: 0,
          },
        ],
      },
    ],
    changes: [
      {
        minute: 8,
        kind: 'deploy',
        ref: 'v2026.3.17-c2',
        actor: 'ci-bot',
        summary: 'worker: retry backoff tuning',
      },
    ],
    alerts: [
      {
        minute: 34,
        name: 'CallbackDeliveryStalled',
        severity: 'page',
        state: 'firing',
      },
      { minute: 44, name: 'RetryQueueDepth', severity: 'ticket', state: 'firing' },
    ],
    requiredEvidence: [
      {
        source: 'logs/app.jsonl',
        match: 'certificate has expired',
        why: 'the TLS error naming the peer and expiry instant',
      },
      {
        source: 'logs/app.jsonl',
        match: '2026-03-17T09:30:00Z',
        why: 'the notAfter matching onset exactly',
      },
      {
        source: 'metrics/callbacks.csv',
        match: '$onset',
        why: 'the delivered_per_min series at onset, delivery collapsing at the same minute',
      },
    ],
    redHerrings: [
      {
        source: 'changes.jsonl',
        match: 'v2026.3.17-c2',
        why_tempting: 'the only deploy in the window, and it touched retry logic',
      },
    ],
  },
];
