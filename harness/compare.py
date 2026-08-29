#!/usr/bin/env python3
"""Turn the recorded runs into the evidence table for the write-up.

Reads every results/*.json, groups by variant, and reports mean and standard
deviation per metric across seeds, plus the delta against the baseline. The
spread is the point: it is what lets a judge see that an improvement is larger
than run-to-run noise.

Usage:
    bench/compare.py                       # markdown table to stdout
    bench/compare.py --out RESULTS.md      # also write it to a file
    bench/compare.py --baseline baseline   # name the reference variant
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
RESULTS = REPO_ROOT / "results"


def load() -> dict[str, list[dict]]:
    by_variant: dict[str, list[dict]] = defaultdict(list)
    for path in sorted(RESULTS.glob("*.json")):
        try:
            rec = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            print(f"warn: {path.name} is not valid JSON, skipping", file=sys.stderr)
            continue
        by_variant[rec.get("variant", "unknown")].append(rec)
    return by_variant


def agg(records: list[dict]) -> dict[str, tuple[float, float, int]]:
    """metric -> (mean, stdev, n). Only successful runs contribute."""
    values: dict[str, list[float]] = defaultdict(list)
    for rec in records:
        if rec.get("exit_code") not in (0, None):
            continue
        for key, val in (rec.get("metrics") or {}).items():
            if isinstance(val, (int, float)) and not isinstance(val, bool):
                values[key].append(float(val))
        if isinstance(rec.get("duration_s"), (int, float)):
            values["duration_s"].append(float(rec["duration_s"]))
    return {
        k: (statistics.fmean(v), statistics.stdev(v) if len(v) > 1 else 0.0, len(v))
        for k, v in values.items()
    }


def fmt(x: float) -> str:
    if x == 0:
        return "0"
    if abs(x) >= 1000 or abs(x) < 0.001:
        return f"{x:.3g}"
    return f"{x:.4g}"


def metric_cell(name: str, metric: str, agg: dict, base: dict, reference: str) -> str:
    if metric not in agg:
        return "—"
    mean, sd, _ = agg[metric]
    cell = f"{fmt(mean)} ± {fmt(sd)}"
    if name != reference and metric in base and base[metric][0]:
        delta = (mean - base[metric][0]) / abs(base[metric][0]) * 100
        cell += f" ({delta:+.1f}%)"
    return cell


def render_table(order, aggs, by_variant, metrics, reference) -> list[str]:
    lines = ["| variant | runs | " + " | ".join(metrics) + " |",
             "|---|---|" + "---|" * len(metrics)]
    base = aggs.get(reference, {})
    for name in order:
        agg_for = aggs[name]
        ok = max((v[2] for v in agg_for.values()), default=0)
        cells = [metric_cell(name, m, agg_for, base, reference) for m in metrics]
        lines.append(f"| `{name}` | {ok}/{len(by_variant[name])} | " + " | ".join(cells) + " |")
    return lines


def render_provenance(order, by_variant) -> list[str]:
    # A results table nobody can trace back to a commit is not evidence.
    lines = ["\n## Provenance\n", "| variant | commit | container | command |", "|---|---|---|---|"]
    for name in order:
        rec = by_variant[name][0]
        lines.append(
            f"| `{name}` | `{rec.get('commit', '?')[:12]}` | "
            f"`{rec.get('env', {}).get('container', '?')}` | `{rec.get('cmd', '?')}` |"
        )
    return lines


def render_contamination(by_variant) -> list[str]:
    """Call out runs that lost cases to the provider.

    Averaging these in would present a billing failure as a measurement. The
    row stays in the table so the run is not silently dropped, but it is
    labelled so nobody reads a number off it.
    """
    bad = []
    for name, recs in by_variant.items():
        for rec in recs:
            errors = (rec.get("metrics") or {}).get("provider_errors", 0)
            if errors:
                bad.append((name, rec["seed"], errors, len(rec["metrics"].get("cases_detail", []))))
    if not bad:
        return []
    lines = ["\n## Unreliable runs\n",
             "These lost cases to the provider (auth, credit or rate limits), not to the "
             "workflow. Their numbers measure nothing and must not be compared.\n",
             "| variant | seed | cases lost |", "|---|---|---|"]
    for name, seed, errors, total in bad:
        lines.append(f"| `{name}` | {seed} | {errors}/{total} |")
    return lines


def render_failures(by_variant) -> list[str]:
    failed = [(n, r["seed"], r.get("error", "")[:80])
              for n, recs in by_variant.items() for r in recs
              if r.get("exit_code") not in (0, None)]
    if not failed:
        return []
    return ["\n## Failed runs\n"] + [f"- `{n}` seed {s}: {e}" for n, s, e in failed]


def header(reference: str) -> list[str]:
    return ["# Results\n",
            f"Reference variant: `{reference}`. Each cell is mean ± stdev "
            "across seeds; delta is versus the reference.\n",
            "`replayed_calls` equal to `llm_calls` means the run came from the "
            "committed cassettes. For those rows `duration_s` and "
            "`seconds_per_case` measure replay, not the recorded run; token "
            "counts and cost are the recorded values and are comparable.\n"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--baseline", default="baseline", help="reference variant name")
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args()

    by_variant = load()
    if not by_variant:
        print(f"error: no result files in {RESULTS}", file=sys.stderr)
        return 2

    aggs = {name: agg(recs) for name, recs in by_variant.items()}
    # Reference first, then the rest alphabetically, so ablations read in order.
    order = ([args.baseline] if args.baseline in aggs else []) + \
            sorted(n for n in aggs if n != args.baseline)
    metrics = sorted({m for a in aggs.values() for m in a})

    lines = header(args.baseline)
    lines += render_table(order, aggs, by_variant, metrics, args.baseline)
    lines += render_provenance(order, by_variant)
    lines += render_contamination(by_variant)
    lines += render_failures(by_variant)

    text = "\n".join(lines) + "\n"
    print(text)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text, encoding="utf-8")
        print(f"written to {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
