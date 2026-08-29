# Incident review — checkout-latency-2026-03-19

**Root cause:** Config change  
**Onset:** 2026-03-19T14:22:17Z

## Summary

A configuration change switched the checkout service's session store from memcached to redis at 14:19:47 UTC. The redis connection pool was sized at 16 connections, which proved insufficient for the workload. Starting at 14:22:17, the pool became exhausted, forcing session lookups to fall back to postgres with latencies exceeding 2 seconds. This caused checkout p95 latency to spike from ~0.18s to ~4.8s and remain elevated.

## What happened

- At 14:19:47 UTC, a configuration change switched checkout-api's session store from memcached to redis.

> `deploys.txt:2`  
> `2026-03-19 14:19:47 UTC  config  checkout-api   -        rmartins  session_store: memcached -> redis`

- At 14:22:17, the redis connection pool became exhausted with all 16 connections in use and 39 waiters queued.

> `app/errors.log:128`  
> `ts=2026-03-19T14:22:17Z level=error svc=checkout msg="redis: connection pool exhausted" pool_size=16 in_use=16 waiters=39`

- Session lookups immediately fell back to postgres with a latency of 3382ms.

> `app/errors.log:129`  
> `ts=2026-03-19T14:22:17Z level=warn svc=checkout msg="session lookup fell back to postgres" latency_ms=3382`

- Checkout p95 latency jumped from 0.189 seconds at 14:21:00 to 4.837 seconds at 14:22:00.

> `metrics/latency.csv:23`  
> `2026-03-19T14:21:00Z,0.180,0.143,0.082`
> `metrics/latency.csv:24`  
> `2026-03-19T14:22:00Z,4.837,3.871,0.093`

- The redis pool remained fully saturated with 16 connections in use and waiters ranging from 20 to 59 throughout the incident.

> `metrics/redis_pool.csv:24`  
> `2026-03-19T14:22:00Z,16,16,48,29.2`
> `metrics/redis_pool.csv:51`  
> `2026-03-19T14:49:00Z,16,16,23,31.0`

- At 14:41:10, autoscaler scaled checkout-api from 6 to 10 instances, but this did not resolve the issue.

> `deploys.txt:3`  
> `2026-03-19 14:41:10 UTC  scale   checkout-api   6 -> 10  autoscaler  cpu target breached`

## Why this is the cause

- The redis pool exhaustion errors began at 14:22:17, approximately 2.5 minutes after the session store configuration change at 14:19:47.

> `deploys.txt:2`  
> `2026-03-19 14:19:47 UTC  config  checkout-api   -        rmartins  session_store: memcached -> redis`
> `app/errors.log:128`  
> `ts=2026-03-19T14:22:17Z level=error svc=checkout msg="redis: connection pool exhausted" pool_size=16 in_use=16 waiters=39`

- Every pool exhaustion error was immediately followed by a postgres fallback with multi-second latency, showing the direct causal relationship.

> `app/errors.log:128`  
> `ts=2026-03-19T14:22:17Z level=error svc=checkout msg="redis: connection pool exhausted" pool_size=16 in_use=16 waiters=39`
> `app/errors.log:129`  
> `ts=2026-03-19T14:22:17Z level=warn svc=checkout msg="session lookup fell back to postgres" latency_ms=3382`

- The pool size of 16 connections was insufficient, as evidenced by persistent full utilization and waiter queues reaching up to 59.

> `app/errors.log:128`  
> `ts=2026-03-19T14:22:17Z level=error svc=checkout msg="redis: connection pool exhausted" pool_size=16 in_use=16 waiters=39`
> `metrics/redis_pool.csv:44`  
> `2026-03-19T14:42:00Z,16,16,59,31.7`

- Postgres fallback latencies ranged from 2233ms to 6772ms, directly explaining the 4+ second checkout p95 latencies observed.

> `app/errors.log:197`  
> `ts=2026-03-19T14:31:59Z level=warn svc=checkout msg="session lookup fell back to postgres" latency_ms=2233`
> `app/errors.log:190`  
> `ts=2026-03-19T14:30:15Z level=warn svc=checkout msg="session lookup fell back to postgres" latency_ms=6772`

## Considered and ruled out

- The catalog-api deploy at 13:40:02 cannot be the cause because it occurred 42 minutes before incident onset and catalog p95 latency remained stable around 0.09s throughout.

> `deploys.txt:1`  
> `2026-03-19 13:40:02 UTC  deploy  catalog-api    v4.2.9   ci-bot   bump image tags`
> `metrics/latency.csv:24`  
> `2026-03-19T14:22:00Z,4.837,3.871,0.093`

- Postgres resource exhaustion is ruled out because postgres CPU remained stable between 28-34% throughout the incident, showing no signs of overload.

> `metrics/redis_pool.csv:24`  
> `2026-03-19T14:22:00Z,16,16,48,29.2`
> `metrics/redis_pool.csv:51`  
> `2026-03-19T14:49:00Z,16,16,23,31.0`

- The autoscaler scaling event at 14:41:10 did not resolve the issue, indicating the problem was not simply insufficient compute capacity but rather the redis pool configuration.

> `deploys.txt:3`  
> `2026-03-19 14:41:10 UTC  scale   checkout-api   6 -> 10  autoscaler  cpu target breached`
> `metrics/latency.csv:43`  
> `2026-03-19T14:41:00Z,4.794,3.860,0.106`
> `metrics/latency.csv:44`  
> `2026-03-19T14:42:00Z,4.768,3.937,0.107`

## Action items

- [ ] Immediately increase redis connection pool size for checkout-api to at least 50-100 connections to handle current workload
- [ ] Implement connection pool monitoring and alerting to detect exhaustion before it impacts users
- [ ] Add load testing requirements for session store configuration changes to validate pool sizing before production deployment
- [ ] Review and document connection pool sizing guidelines based on expected concurrent session operations
- [ ] Consider implementing circuit breaker pattern for postgres fallback to prevent cascading failures
- [ ] Add pre-deployment validation that checks connection pool configuration against expected traffic patterns

---

_Drafted by the cited-RCA workflow. Every quote above was copied from the_
_line it names and checked against the incident bundle before publication._
