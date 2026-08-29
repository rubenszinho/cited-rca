#!/usr/bin/env python3
"""Compare two result sets on the numbers that must be deterministic.

The reproducibility claim is not "the file is byte-identical" - wall-clock
duration and replay speed differ between machines, and the results table
carries both. The claim is that the same cassettes and the same grader produce
the same grades.

So this compares the graded outcome of every case and the rates derived from
it, and deliberately ignores timing.

    tools/repro/compare_results.py <expected-dir> <actual-dir>
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

# Everything the grader decides. Timing and provenance are excluded on purpose.
GRADED_RATES = (
    "pass_rate",
    "cause_accuracy",
    "citation_validity",
    "evidence_recall",
    "red_herring_rate",
    "provider_errors",
    "llm_calls",
    "prompt_tokens",
    "completion_tokens",
)


def load(directory: Path) -> dict[str, dict]:
    runs: dict[str, dict] = {}
    for path in sorted(directory.glob("*.json")):
        record = json.loads(path.read_text(encoding="utf-8"))
        runs[f"{record['variant']}-seed{record['seed']}"] = record["metrics"]
    return runs


def diff_run(name: str, expected: dict, actual: dict) -> list[str]:
    problems = []
    for key in GRADED_RATES:
        if expected.get(key) != actual.get(key):
            problems.append(f"{name}: {key} expected {expected.get(key)}, got {actual.get(key)}")

    by_case = {c["case_id"]: c for c in actual.get("cases_detail", [])}
    for case in expected.get("cases_detail", []):
        got = by_case.get(case["case_id"])
        if got is None:
            problems.append(f"{name}: case {case['case_id']} missing from the reproduction")
        elif got["passed"] != case["passed"]:
            problems.append(
                f"{name}: case {case['case_id']} expected "
                f"{'PASS' if case['passed'] else 'FAIL'}, got "
                f"{'PASS' if got['passed'] else 'FAIL'}"
            )
    return problems


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    expected, actual = load(Path(sys.argv[1])), load(Path(sys.argv[2]))

    problems = []
    for name in sorted(expected):
        if name not in actual:
            problems.append(f"{name}: present in the committed results, absent from the clone")
            continue
        problems.extend(diff_run(name, expected[name], actual[name]))

    if problems:
        print(f"REPRO MISMATCH — {len(problems)} difference(s):", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        return 1

    cases = sum(len(m.get("cases_detail", [])) for m in expected.values())
    print(f"REPRO OK — {len(expected)} run(s), {cases} graded cases, identical outcomes.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
