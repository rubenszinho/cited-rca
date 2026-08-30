#!/usr/bin/env python3
"""Fail if a document quotes a metric that no committed run produced.

Every number in the write-up is supposed to have a run behind it. That was true
of the tables and not of the prose: a reviewer found a whole section quoting
figures from a grid that had been re-recorded, one of them sign-inverted and one
attributed to a model with no committed results. In a project whose argument is
that claims need evidence, that is the failure it claims to have eliminated.

This extracts three-decimal figures from the docs and checks each against the
metrics actually present in results/. It is deliberately crude: false alarms are
cheap, an unbacked number in the argument is not.

    tools/repro/verify_claims.py docs/CHANGELOG.md README.md
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
RESULTS = ROOT / "results"

NUMBER = re.compile(r"\b0\.\d{3}\b")

# Figures that are not run metrics: thresholds, versions, prose fractions.
IGNORE = {"0.000"}


def observed() -> set[str]:
    """Every metric value any run recorded, to three decimals."""
    seen: set[str] = set()
    for path in RESULTS.glob("*.json"):
        metrics = json.loads(path.read_text(encoding="utf-8"))["metrics"]
        for value in metrics.values():
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                seen.add(f"{value:.3f}")
        for case in metrics.get("cases_detail", []):
            seen.add(f"{case['evidence_recall']:.3f}")
    return seen


def means() -> set[str]:
    """Per-variant means, which is what the prose usually quotes."""
    import collections
    import statistics

    by: dict[str, list[dict]] = collections.defaultdict(list)
    for path in RESULTS.glob("*.json"):
        record = json.loads(path.read_text(encoding="utf-8"))
        by[record["variant"]].append(record["metrics"])
    seen: set[str] = set()
    for runs in by.values():
        keys = {k for r in runs for k, v in r.items() if isinstance(v, (int, float))}
        for key in keys:
            values = [r[key] for r in runs if isinstance(r.get(key), (int, float))]
            if values:
                seen.add(f"{statistics.fmean(values):.3f}")
                if len(values) > 1:
                    seen.add(f"{statistics.stdev(values):.3f}")
    return seen


def paired() -> set[str]:
    """Committed paired comparisons, for claims about one variant against another.

    Deliberately reads only the pairs under results/paired/ rather than deriving
    every pair on demand. All-pairs backing was measured: it grows the accepted
    set from 359 to 772 of the 1000 possible three-decimal values, which passes
    almost any figure. See harness/paired.py.
    """
    seen: set[str] = set()
    for path in (RESULTS / "paired").glob("*.json"):
        record = json.loads(path.read_text(encoding="utf-8"))
        for stats in record["differences"].values():
            for key in ("mean", "stdev"):
                seen.add(f"{abs(stats[key]):.3f}")
            for delta in stats["per_seed"]:
                seen.add(f"{abs(delta):.3f}")
    return seen


def main() -> int:
    if not RESULTS.exists() or not any(RESULTS.glob("*.json")):
        print("error: no results to check claims against", file=sys.stderr)
        return 2
    known = observed() | means() | paired() | IGNORE

    problems: list[str] = []
    for arg in sys.argv[1:]:
        path = Path(arg)
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            for number in NUMBER.findall(line):
                if number not in known:
                    problems.append(f"{path}:{lineno}: {number} matches no committed run")

    for problem in problems:
        print(f"  {problem}", file=sys.stderr)
    if problems:
        print(f"{len(problems)} unbacked figure(s)", file=sys.stderr)
        return 1
    print(f"every three-decimal figure in {len(sys.argv) - 1} document(s) is backed by results/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
