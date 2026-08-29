# Running on a real incident

The twelve cases under `fixtures/cases/` exist to grade the workflow: their
root cause is known exactly, so the evaluation can be deterministic. They are
not what using this looks like.

This directory is. `checkout-latency-2026-03-19/` is an incident folder in
formats the workflow has never been shown:

| File                     | Format                                |
| ------------------------ | ------------------------------------- |
| `access.log`             | nginx combined access log, plain text |
| `app/errors.log`         | logfmt application log, plain text    |
| `metrics/latency.csv`    | Prometheus-style CSV export           |
| `metrics/redis_pool.csv` | Prometheus-style CSV export           |
| `deploys.txt`            | plain-text change record              |

No JSON logs, no fixture filenames, no layout the code knows about. Run it:

```bash
task project:dev -- --dir examples/checkout-latency-2026-03-19
```

`REVIEW.md` in that folder is the unedited output. It identified the config
change that switched the session store to redis, connected it to a
sixteen-connection pool exhausting three minutes later, and ruled out the
autoscaler event that fired during the incident. Every citation resolves
against the source files.

## On real production logs

`public-hadoop/` goes further: it is a genuine, unsanitised production log
sample from [loghub](https://github.com/logpai/loghub), published for
log-analytics research. Nobody wrote it for this project and nothing about it
was cleaned up.

```bash
tools/demo/fetch-public-logs.sh Hadoop
```

The dataset is fetched, never committed — this repository redistributes none of
it. `REVIEW.md` is the generated output.

From 1,999 lines of raw Hadoop output it found the failure: `NoRouteToHost`
exceptions reaching `msra-sa-41:9000`, the RMCommunicator failing to contact the
Resource Manager, and address-change warnings showing the hostname resolving
inconsistently. Every citation resolves against the file.

**What this does and does not show.** It shows the workflow handles real,
messy, unfamiliar log formats and that its citations hold up against them. It
does not show the diagnosis is correct — nobody published the ground truth for
this sample, and the root-cause enum was designed for the synthetic set, so on
arbitrary real data it is a rough fit at best. Correctness is measured on the
twelve cases, where the answer is known. This is evidence of generality, not of
accuracy, and the two should not be confused.

## Why this works on any directory

An incident bundle is only "a set of text files, each addressable by line",
which is also the entire requirement for a citation: a file name and a line
number. `src/ingest.ts` reads every log, CSV or export it finds and keeps the
user's own filenames as the source names in the review.

The split between "read this in full" and "search this" is by size, not by
name — a change record is worth reading whole and a two-thousand-line log is
not. That was originally the hardcoded filename `logs/app.jsonl`, which worked
on the fixtures and made the workflow unusable on a real directory, which is
the one thing ingestion existed for.

## What is not claimed

There is no ground truth here, so correctness cannot be scored — nobody knows
the real answer. What is still checked, and printed after the review, is
whether every citation resolves against the files. That is the check that runs
in production, and the one a reader needs before trusting the document.
