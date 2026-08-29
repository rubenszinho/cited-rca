/**
 * Faults where the system runs out of something.
 *
 * The shared trap in this group is that the change timeline holds nothing
 * useful: the trigger is a resource curve, so a workflow that reaches for the
 * most recent deploy every time fails all four.
 */
import type { Scenario } from '../synth/spec.ts';
import { CHATTER, latencyMetric } from './common.ts';

export const RESOURCE_SCENARIOS: Scenario[] = [
  {
    id: '05-connection-pool-exhaustion',
    title: 'API stalls while the database sits idle',
    rootCause: 'resource_exhaustion_pool',
    summary:
      'A reporting endpoint has held pool connections open across an external call ' +
      'for weeks. Reporting traffic grew past the point where the 40-slot pool could ' +
      'absorb it, and unrelated requests began queueing for a connection. No change ' +
      'triggered this: the system crossed a threshold it had been approaching.',
    windowMinutes: 60,
    onsetMinute: 21,
    detectMinute: 29,
    logs: {
      normalRatePerMin: 27,
      normal: CHATTER,
      onFault: [
        {
          service: 'db-proxy',
          level: 'warn',
          msg: 'connection pool wait exceeded 1000ms',
          ratePerMin: 10,
          fields: { pool: 'primary', size: 40, waiting: 37 },
        },
        {
          service: 'api',
          level: 'error',
          msg: 'timed out acquiring database connection',
          ratePerMin: 6,
          fields: { req: '$id', waited_ms: 5000 },
        },
      ],
    },
    metrics: [
      latencyMetric(7.8, 26),
      {
        name: 'pool',
        series: [
          {
            name: 'active',
            base: 12,
            noisePct: 0.2,
            after: { shape: 'step', factor: 3.3 },
            precision: 0,
          },
          {
            name: 'idle',
            base: 28,
            noisePct: 0.15,
            after: { shape: 'drain', factor: 28 },
            precision: 0,
          },
          {
            name: 'waiting',
            base: 0,
            noisePct: 0,
            // Requests queueing for a pool slot: the series that names the
            // contended resource, and it climbs from nothing.
            after: { shape: 'ramp', delta: 37 },
            precision: 0,
          },
        ],
      },
      {
        name: 'db',
        series: [
          // The database is fine. This series is the control that rules out
          // "the database is slow" and points back at the caller.
          {
            name: 'cpu_pct',
            base: 28,
            noisePct: 0.1,
            after: { shape: 'flat', factor: 1 },
            precision: 1,
          },
          {
            name: 'mean_query_ms',
            base: 9,
            noisePct: 0.15,
            after: { shape: 'flat', factor: 1 },
            precision: 1,
          },
        ],
      },
    ],
    // Nothing here caused it. That is the point of the case: an incident with
    // no triggering change, in a set where most incidents have one. The earlier
    // version had this deploy add the connection-holding code, which made
    // "bad deploy" a defensible answer the enum could not express.
    changes: [
      {
        minute: 6,
        kind: 'deploy',
        ref: 'v2026.3.17-d1',
        actor: 'ci-bot',
        summary: 'api: update the 404 page copy and favicon',
      },
    ],
    alerts: [
      { minute: 29, name: 'ApiLatencyP95', severity: 'page', state: 'firing' },
      { minute: 33, name: 'DbConnectionWait', severity: 'ticket', state: 'firing' },
    ],
    requiredEvidence: [
      {
        source: 'logs/app.jsonl',
        match: 'connection pool wait exceeded',
        why: 'the pool, not the database, is the contended resource',
      },
      {
        source: 'metrics/pool.csv',
        match: '$onset',
        why: 'the idle series at onset, idle connections draining to zero',
      },
      {
        source: 'metrics/db.csv',
        match: '$onset',
        why: 'the cpu_pct series at onset, database CPU flat, ruling out a slow database',
      },
    ],
    redHerrings: [
      {
        source: 'logs/app.jsonl',
        match: 'timed out acquiring database connection',
        why_tempting:
          'the error names the database, so it reads as a slow database - but database ' +
          'CPU and mean query time are both flat',
      },
      {
        source: 'changes.jsonl',
        match: 'v2026.3.17-d1',
        why_tempting:
          'the only change in the window, and every other incident in this set has a ' +
          'change behind it - but this one touches a 404 page and no request path',
      },
    ],
  },
  {
    id: '06-memory-leak-oom',
    title: 'Workers restarting every few minutes',
    rootCause: 'memory_leak',
    summary:
      'Each job appended to a module-level cache that was never evicted, so worker ' +
      'RSS climbed until the container hit its limit and was OOM-killed.',
    windowMinutes: 60,
    onsetMinute: 14,
    detectMinute: 32,
    logs: {
      normalRatePerMin: 25,
      normal: CHATTER,
      onFault: [
        {
          service: 'worker',
          level: 'warn',
          msg: 'heap usage above 85% of limit',
          ratePerMin: 4,
          fields: { rss_mb: 1740, limit_mb: 2048 },
        },
        {
          service: 'worker',
          level: 'error',
          msg: 'container terminated: OOMKilled',
          ratePerMin: 1,
          fields: { restarts: 4, exit_code: 137 },
        },
      ],
    },
    metrics: [
      latencyMetric(1.9, 9),
      {
        name: 'worker',
        series: [
          // A ramp, not a step: the shape is what separates a leak from a spike.
          {
            name: 'rss_mb',
            base: 420,
            noisePct: 0.04,
            after: { shape: 'ramp', factor: 4.6 },
            precision: 0,
          },
          {
            name: 'restarts_total',
            base: 0,
            noisePct: 0,
            // Matches the four restarts the OOM log line reports.
            after: { shape: 'ramp', delta: 4 },
            precision: 0,
          },
          {
            name: 'jobs_per_min',
            base: 61,
            noisePct: 0.1,
            after: { shape: 'drain', factor: 2.2 },
            precision: 0,
          },
        ],
      },
    ],
    changes: [
      {
        minute: 10,
        kind: 'deploy',
        ref: 'v2026.3.17-e7',
        actor: 'ci-bot',
        summary: 'worker: memoise partner lookups',
      },
      {
        minute: 47,
        kind: 'scale',
        ref: 'worker',
        actor: 'sre-oncall',
        summary: 'worker replicas 4 -> 8 (mitigation attempt)',
      },
    ],
    alerts: [
      { minute: 32, name: 'WorkerRestartLoop', severity: 'page', state: 'firing' },
      { minute: 38, name: 'JobBacklogGrowing', severity: 'ticket', state: 'firing' },
    ],
    requiredEvidence: [
      {
        source: 'logs/app.jsonl',
        match: 'OOMKilled',
        why: 'the kill reason and exit code 137',
      },
      {
        source: 'metrics/worker.csv',
        match: '$onset',
        why: 'the rss_mb series at onset, memory climbing monotonically rather than spiking',
      },
      {
        source: 'changes.jsonl',
        match: 'v2026.3.17-e7',
        why: 'the memoisation deploy four minutes before the climb starts',
      },
    ],
    redHerrings: [
      {
        source: 'changes.jsonl',
        match: 'worker replicas 4 -> 8',
        why_tempting:
          'a change during the incident, but an operator mitigation rather than the cause',
      },
    ],
  },
  {
    id: '07-disk-exhaustion-logs',
    title: 'Writes failing on one node at 60% traffic',
    rootCause: 'disk_exhaustion',
    summary:
      'Debug logging left enabled on api-3 filled the volume; once it hit 100% the ' +
      'node failed every write, while the other two nodes served normally.',
    windowMinutes: 60,
    onsetMinute: 34,
    detectMinute: 37,
    logs: {
      normalRatePerMin: 29,
      normal: CHATTER,
      onFault: [
        {
          service: 'api',
          level: 'error',
          msg: 'write failed: no space left on device',
          ratePerMin: 9,
          fields: { node: 'api-3', path: '/var/lib/app' },
        },
        {
          service: 'api',
          level: 'warn',
          msg: 'log rotation failed',
          ratePerMin: 3,
          fields: { node: 'api-3', free_bytes: 0 },
        },
      ],
    },
    metrics: [
      latencyMetric(1.4, 17),
      {
        name: 'disk',
        series: [
          {
            name: 'api3_used_pct',
            base: 61,
            noisePct: 0.01,
            after: { shape: 'ramp', factor: 1.64 },
            precision: 1,
          },
          {
            name: 'api1_used_pct',
            base: 44,
            noisePct: 0.01,
            after: { shape: 'flat', factor: 1 },
            precision: 1,
          },
          {
            name: 'api2_used_pct',
            base: 46,
            noisePct: 0.01,
            after: { shape: 'flat', factor: 1 },
            precision: 1,
          },
        ],
      },
    ],
    changes: [
      {
        minute: 2,
        kind: 'flag',
        ref: 'debug_request_logging',
        actor: 'lsantos',
        summary: 'enabled on api-3 to chase a support ticket',
      },
    ],
    alerts: [
      { minute: 37, name: 'ApiWriteErrors', severity: 'page', state: 'firing' },
      { minute: 39, name: 'DiskSpaceCritical', severity: 'page', state: 'firing' },
    ],
    requiredEvidence: [
      {
        source: 'logs/app.jsonl',
        match: 'no space left on device',
        why: 'the failure mode, scoped to one node',
      },
      {
        source: 'metrics/disk.csv',
        match: '$onset',
        why: 'the api3_used_pct series at onset, one node climbing while its peers stay flat',
      },
      {
        source: 'changes.jsonl',
        match: 'debug_request_logging',
        why: 'the flag that started the growth, 32 minutes before onset',
      },
    ],
    redHerrings: [
      {
        source: 'alerts.jsonl',
        match: 'ApiWriteErrors',
        why_tempting:
          'the alert is fleet-scoped and names no node, so it reads as a fleet-wide ' +
          'fault when only api-3 is affected',
      },
    ],
  },
  {
    id: '08-cache-stampede',
    title: 'Database saturated seconds after a cache flush',
    rootCause: 'cache_stampede',
    summary:
      'A manual cache flush invalidated every key at once with no request ' +
      'coalescing, so concurrent misses hit the database with identical queries.',
    windowMinutes: 60,
    onsetMinute: 25,
    detectMinute: 27,
    logs: {
      normalRatePerMin: 31,
      normal: CHATTER,
      onFault: [
        {
          service: 'api',
          level: 'warn',
          msg: 'cache miss, recomputing',
          ratePerMin: 14,
          fields: { key: 'catalog:index', concurrent: 212 },
        },
        {
          service: 'db-proxy',
          level: 'error',
          msg: 'too many connections',
          ratePerMin: 7,
          fields: { active: 100, max: 100 },
        },
      ],
    },
    metrics: [
      latencyMetric(6.2, 31),
      {
        name: 'cache',
        series: [
          {
            name: 'hit_rate',
            base: 0.94,
            noisePct: 0.02,
            after: { shape: 'drain', factor: 18 },
            precision: 4,
          },
          {
            name: 'origin_qps',
            base: 22,
            noisePct: 0.15,
            after: { shape: 'spike', factor: 26 },
            precision: 0,
          },
        ],
      },
    ],
    changes: [
      {
        minute: 24,
        kind: 'batch',
        ref: 'cache-flush',
        actor: 'pmoreira',
        summary: 'manual FLUSHALL on the catalog cache after a pricing correction',
      },
    ],
    alerts: [
      { minute: 27, name: 'DbConnectionsSaturated', severity: 'page', state: 'firing' },
      { minute: 28, name: 'CacheHitRateLow', severity: 'ticket', state: 'firing' },
    ],
    requiredEvidence: [
      {
        source: 'changes.jsonl',
        match: 'FLUSHALL',
        why: 'the flush one minute before onset',
      },
      {
        source: 'metrics/cache.csv',
        match: '$onset',
        why: 'the hit_rate series at onset, hit rate collapsing rather than degrading',
      },
      {
        source: 'logs/app.jsonl',
        match: 'cache miss, recomputing',
        why: 'concurrent recomputation of the same key, which is what makes it a stampede',
      },
    ],
    redHerrings: [
      {
        source: 'logs/app.jsonl',
        match: 'too many connections',
        why_tempting:
          'the database is where the pain surfaces, but it is saturated by the stampede rather than causing it',
      },
    ],
  },
];
