#!/usr/bin/env python3
"""Run one solution variant across N seeds and record the evidence.

The rubric asks for a baseline and an improved solution "with evidence". A
single before/after number is weak evidence: it cannot distinguish a real
improvement from run-to-run noise. This runner executes a variant once per
seed and writes one result file per run, so compare.py can report a mean and
a spread rather than a single lucky number.

The runner is deliberately language-agnostic. It shells out to a command and
reads a JSON object of metrics from that command - stdout (last JSON line) or
a file named by --metrics-file. The solution can therefore be Python, Go,
TypeScript, or a shell pipeline without changing the harness.

Usage:
    bench/run.py --variant baseline --seeds 5 --cmd "python3 src/solve.py"
    bench/run.py --variant improved --seeds 5 --cmd "node src/solve.js"
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
RESULTS = REPO_ROOT / "results"


# Paths whose contents decide what a run does. Deliberately excludes results/
# and docs/: a run writes results while it executes, so checking the whole tree
# marked every run dirty against its own output and the hash stopped
# identifying anything. Provenance has to describe the code, not the artefacts.
CODE_PATHS = ["src", "fixtures", "harness", "tools", "package.json", "pnpm-lock.yaml"]


def git_commit() -> str:
    """HEAD, marked dirty only when the *code* differs from it.

    A `-dirty` suffix means the hash cannot be used to reconstruct the run, so
    it must mean something specific. Here it means source changed since the
    commit, which is the only thing that would change what a run produces.
    """
    try:
        out = subprocess.run(
            ["git", "-C", str(REPO_ROOT), "rev-parse", "HEAD"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        dirty = subprocess.run(
            ["git", "-C", str(REPO_ROOT), "status", "--porcelain", "--", *CODE_PATHS],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        return out + ("-dirty" if dirty else "")
    except (subprocess.CalledProcessError, FileNotFoundError):
        return "unknown"


def parse_metrics(stdout: str, metrics_file: Path | None) -> dict:
    """Prefer an explicit metrics file; otherwise take the last JSON object
    printed on stdout, so a solution can log freely above its result line."""
    if metrics_file and metrics_file.exists():
        return json.loads(metrics_file.read_text(encoding="utf-8"))
    for line in reversed(stdout.strip().splitlines()):
        line = line.strip()
        if line.startswith("{") and line.endswith("}"):
            try:
                return json.loads(line)
            except json.JSONDecodeError:
                continue
    raise ValueError(
        "no metrics found: the command must print a JSON object as its last "
        "stdout line, or write one to --metrics-file"
    )


def env_fingerprint() -> dict:
    return {
        "python": platform.python_version(),
        "os": f"{platform.system()} {platform.release()}",
        "machine": platform.machine(),
        # Set by the Dockerfile. Absence means the run was not containerised,
        # which the write-up must disclose.
        "container": os.environ.get("FRONTIER_CONTAINER", "host"),
    }


def run_seed(args, seed: int, commit: str) -> dict:
    """Execute one seed and return the record describing what happened."""
    env = {**os.environ, "SEED": str(seed), "VARIANT": args.variant,
           "PYTHONHASHSEED": str(seed)}
    if args.metrics_file and args.metrics_file.exists():
        args.metrics_file.unlink()

    started = datetime.now(timezone.utc)
    t0 = time.perf_counter()
    proc = subprocess.run(args.cmd, shell=True, capture_output=True, text=True,
                          env=env, cwd=REPO_ROOT, timeout=args.timeout)
    record = {
        "variant": args.variant, "seed": seed, "commit": commit, "cmd": args.cmd,
        "started_at": started.isoformat(),
        "duration_s": round(time.perf_counter() - t0, 4),
        "exit_code": proc.returncode,
        "env": env_fingerprint(),
        "metrics": {},
    }
    if proc.returncode != 0:
        record["error"] = proc.stderr[-2000:]
        return record
    try:
        record["metrics"] = parse_metrics(proc.stdout, args.metrics_file)
    except ValueError as exc:
        record["error"] = str(exc)
    return record


def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--variant", required=True,
                    help="baseline, agent, or an ablation label like agent-noverify")
    ap.add_argument("--cmd", required=True, help="shell command that runs the solution")
    ap.add_argument("--seeds", type=int, default=5)
    ap.add_argument("--seed-start", type=int, default=0)
    ap.add_argument("--metrics-file", type=Path, default=None,
                    help="path the command writes its metrics JSON to")
    ap.add_argument("--timeout", type=int, default=1800)
    return ap.parse_args()


def main() -> int:
    args = parse_args()
    RESULTS.mkdir(parents=True, exist_ok=True)
    commit = git_commit()
    failures = 0

    for seed in range(args.seed_start, args.seed_start + args.seeds):
        record = run_seed(args, seed, commit)
        # A provider error is not a workflow result, and the solution catches
        # them per case rather than crashing - so the process still exits 0.
        # Counting only the exit code let a clean clone report "6/6 runs ok"
        # for six runs in which every one of twelve cases failed to reach a
        # model at all, and the zeros then flowed into the results table.
        provider_errors = record["metrics"].get("provider_errors", 0)
        if record.get("error") or record["exit_code"] != 0 or provider_errors:
            failures += 1
            reason = record.get("error") or f"{provider_errors} provider error(s)"
            print(f"seed {seed}: FAILED ({reason[:120]})", file=sys.stderr)

        dest = RESULTS / f"{args.variant}-seed{seed}.json"
        dest.write_text(json.dumps(record, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        # Scalars only. cases_detail is a list of twelve objects and printing
        # it buries the line a human is trying to read.
        summary = ", ".join(
            f"{k}={v}" for k, v in record["metrics"].items()
            if isinstance(v, (int, float, str))
        )
        print(f"seed {seed}: {record['duration_s']:7.3f}s  "
              f"{summary or '(no metrics)'}  -> {dest.name}")

    print(f"\n{args.seeds - failures}/{args.seeds} runs ok for variant '{args.variant}'")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
