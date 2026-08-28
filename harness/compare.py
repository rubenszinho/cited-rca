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
    base = aggs.get(args.baseline, {})

    # Baseline first, then the rest alphabetically, so ablations read in order.
    order = ([args.baseline] if args.baseline in aggs else []) + \
            sorted(n for n in aggs if n != args.baseline)

    metrics = sorted({m for a in aggs.values() for m in a})
    lines: list[str] = []
    lines.append("# Results\n")
    lines.append(f"Reference variant: `{args.baseline}`. "
                 "Each cell is mean ± stdev across seeds; delta is versus the reference.\n")

    header = "| variant | runs | " + " | ".join(metrics) + " |"
    sep = "|---|---|" + "---|" * len(metrics)
    lines += [header, sep]

    for name in order:
        a = aggs[name]
        total = len(by_variant[name])
        ok = max((v[2] for v in a.values()), default=0)
        cells = []
        for m in metrics:
            if m not in a:
                cells.append("—")
                continue
            mean, sd, _ = a[m]
            cell = f"{fmt(mean)} ± {fmt(sd)}"
            if name != args.baseline and m in base and base[m][0]:
                delta = (mean - base[m][0]) / abs(base[m][0]) * 100
                cell += f" ({delta:+.1f}%)"
            cells.append(cell)
        lines.append(f"| `{name}` | {ok}/{total} | " + " | ".join(cells) + " |")

    # Provenance: a results table nobody can trace back to a commit is not evidence.
    lines.append("\n## Provenance\n")
    lines.append("| variant | commit | container | command |")
    lines.append("|---|---|---|---|")
    for name in order:
        rec = by_variant[name][0]
        lines.append(
            f"| `{name}` | `{rec.get('commit', '?')[:12]}` | "
            f"`{rec.get('env', {}).get('container', '?')}` | `{rec.get('cmd', '?')}` |"
        )

    failed = [(n, r["seed"], r.get("error", "")[:80])
              for n, recs in by_variant.items() for r in recs
              if r.get("exit_code") not in (0, None)]
    if failed:
        lines.append("\n## Failed runs\n")
        for name, seed, err in failed:
            lines.append(f"- `{name}` seed {seed}: {err}")

    text = "\n".join(lines) + "\n"
    print(text)
    if args.out:
        args.out.write_text(text, encoding="utf-8")
        print(f"written to {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
