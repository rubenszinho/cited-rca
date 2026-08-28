"""
report.py - Human-readable output
=================================

WHAT THIS FILE DOES:
Renders a Diff to plain text and decides the exit code.

OUTPUT CONTRACT (relied on by CI logs and by agents reading the output):
- The first token is always PASS or FAIL, the last line is always "Exit N."
- File paths start a line, so terminals and editors linkify them.
- The ADVICE block is appended only on failure, and only for the metrics
  that actually failed this run. Advice on a passing run is noise.

EXIT CODES:
  1  regressions and/or new violations
  1  improvements detected in CI mode with a stale baseline (drift)
  0  improvements absorbed into the baseline (local --write)
  0  nothing to report
"""

from __future__ import annotations

from tools.quality.diff import Diff, Improvement, Violation

ADVICE = {
    "nloc": (
        "Long functions don't fit in one mental scan. Extract logical chunks into\n"
        "    helpers with descriptive names; split functions that do more than one thing."
    ),
    "ccn": (
        "Each branch (if/elif/and/or/case/except) adds a path. Extract predicates\n"
        "    into named helpers; use early returns; replace if-chains with table dispatch\n"
        "    (dict lookup); lift type-based branching into polymorphism."
    ),
    "params": (
        "Long param lists signal a function doing too much or over-coupled.\n"
        "    Group related params into a dataclass / context object; consolidate flags\n"
        "    into an options object; pass dependencies via constructor."
    ),
    "file_lines": (
        "A file past the line limit can't be held in context. Split by responsibility\n"
        "    (one class/concern per file); extract handlers into per-unit modules;\n"
        "    move types/schemas/constants into their own files."
    ),
}

NEW_VIOLATION = "NEW VIOLATION"
REGRESSION = "REGRESSION"


def render(
    diff: Diff,
    mode: str,
    baseline_was_written: bool,
    thresholds: dict[str, int],
) -> tuple[str, int]:
    """Render the diff. `mode` is 'ci' or 'local'. Returns (text, exit_code).

    Example: text, code = render(diff, "ci", False, cfg.thresholds)
    """
    if diff["regressions"] or diff["new_violations"]:
        return _render_failure(diff, thresholds)
    improvements = diff["improvements"]
    if improvements and baseline_was_written:
        return _render_absorbed(improvements)
    if improvements and mode == "ci":
        return _render_drift(improvements)
    return "PASS  Quality check.\n\nExit 0.\n", 0


def _render_failure(diff: Diff, thresholds: dict[str, int]) -> tuple[str, int]:
    """Regressions and new violations, in whichever combination occurred."""
    regressions, new = diff["regressions"], diff["new_violations"]
    parts = [_failure_headline(len(regressions), len(new))]
    if regressions:
        parts.append("\nREGRESSIONS (must not exceed baseline value):\n")
        parts += [_format_violation(v, REGRESSION, thresholds) for v in regressions]
    if new:
        parts.append("\nNEW VIOLATIONS (must comply with strict thresholds):\n")
        parts += [_format_violation(v, NEW_VIOLATION, thresholds) for v in new]
    parts.append(_failure_summary(regressions, new))
    parts.append(_format_advice(_failed_metrics(diff)))
    parts.append("\nExit 1.\n")
    return "".join(parts), 1


def _failure_headline(n_regressions: int, n_new: int) -> str:
    if n_regressions and n_new:
        return (
            f"FAIL  Quality check: {n_regressions} regression(s) and "
            f"{n_new} new violation(s).\n"
        )
    if n_regressions:
        return f"FAIL  Quality check: {n_regressions} regression(s).\n"
    return f"FAIL  Quality check: {n_new} new violation(s).\n"


def _failure_summary(
    regressions: list[Violation], new: list[Violation],
) -> str:
    files = len({v["file"] for v in regressions + new})
    lines = [
        f"\nSummary: {len(regressions)} regression(s), {len(new)} new "
        f"violation(s) across {files} file(s).\n",
        "Fix:\n",
    ]
    if regressions:
        lines.append("  - Regressions: each metric must stay <= its baseline value.\n")
    if new:
        lines.append("  - New violations: each metric must be <= its strict max.\n")
    return "".join(lines)


def _format_violation(
    violation: Violation, kind: str, thresholds: dict[str, int],
) -> str:
    if violation["function"] is None:
        return _format_file_violation(violation, kind)
    lines = [violation["file"], f"  function '{violation['function']}' - {kind}"]
    for metric, (current, gate) in violation["metrics"].items():
        lines.append(_metric_line(metric, current, gate, kind, thresholds))
    return "\n".join(lines) + "\n"


def _format_file_violation(violation: Violation, kind: str) -> str:
    current, gate = violation["metrics"]["file_lines"]
    label = "max" if kind == NEW_VIOLATION else "baseline"
    return (
        f"{violation['file']}\n"
        f"  file_lines={current} ({label} {gate}, +{current - gate}) - {kind}\n"
    )


def _metric_line(
    metric: str, current: int, gate: int, kind: str, thresholds: dict[str, int],
) -> str:
    delta = current - gate
    if kind == NEW_VIOLATION:
        return f"    {metric}={current}    (max {gate}, +{delta})"
    return (
        f"    {metric}={current}    (baseline {gate}, +{delta})"
        f"   strict max: {thresholds[metric]}"
    )


def _render_drift(improvements: list[Improvement]) -> tuple[str, int]:
    """CI saw code get better than the committed baseline says it is."""
    files = len({i["file"] for i in improvements})
    parts = [
        f"FAIL  Quality check: baseline is stale - {len(improvements)} "
        "improvement(s) detected but the baseline file was not updated.\n\n",
    ]
    parts += [_format_improvement(i) for i in improvements]
    parts.append(
        f"\nSummary: {len(improvements)} improvement(s) across {files} file(s).\n"
        "Fix: run `task quality:check` locally. It rewrites the baseline.\n"
        "Commit the modified baseline alongside your code changes.\n"
        "\nExit 1.\n"
    )
    return "".join(parts), 1


def _render_absorbed(improvements: list[Improvement]) -> tuple[str, int]:
    """Local --write already rewrote the baseline; report what moved."""
    parts = [
        f"PASS  Quality check: {len(improvements)} improvement(s) absorbed "
        "into the baseline.\n\n",
    ]
    for path, items in _group_by_file(improvements).items():
        parts.append(f"  {path}\n")
        parts += [f"      {_absorbed_line(i)}\n" for i in items]
    parts.append(
        "\nThe baseline file was modified - commit it alongside your code "
        "changes.\n\nExit 0.\n"
    )
    return "".join(parts), 0


def _group_by_file(
    improvements: list[Improvement],
) -> dict[str, list[Improvement]]:
    grouped: dict[str, list[Improvement]] = {}
    for improvement in improvements:
        grouped.setdefault(improvement["file"], []).append(improvement)
    return grouped


def _absorbed_line(improvement: Improvement) -> str:
    if improvement["function"] is None and not improvement["removed"]:
        current, recorded = improvement["metrics"]["file_lines"]
        return f"file_lines {current}->{recorded}"
    if improvement["removed"]:
        name = improvement["function"] or "(file)"
        return f"'{name}' - REMOVED"
    return f"'{improvement['function']}' - {_metric_deltas(improvement)}"


def _metric_deltas(improvement: Improvement) -> str:
    return ", ".join(
        f"{metric} {current}->{recorded}"
        for metric, (current, recorded) in improvement["metrics"].items()
    )


def _format_improvement(improvement: Improvement) -> str:
    if improvement["removed"]:
        name = improvement["function"] or "(file)"
        return (
            f"{improvement['file']}\n"
            f"  '{name}' - REMOVED (deleted or renamed)\n"
        )
    if improvement["function"] is None:
        current, recorded = improvement["metrics"]["file_lines"]
        return (
            f"{improvement['file']}\n"
            f"  file_lines: {current} (baseline says {recorded})\n"
        )
    lines = [improvement["file"], f"  function '{improvement['function']}' - IMPROVEMENT"]
    for metric, (current, recorded) in improvement["metrics"].items():
        lines.append(f"    {metric}: {current}    (baseline says {recorded})")
    return "\n".join(lines) + "\n"


def _failed_metrics(diff: Diff) -> list[str]:
    """Metrics appearing in any violation, in first-seen order."""
    seen: list[str] = []
    for violation in diff["regressions"] + diff["new_violations"]:
        for metric in violation["metrics"]:
            if metric not in seen:
                seen.append(metric)
    return seen


def _format_advice(metrics: list[str]) -> str:
    if not metrics:
        return ""
    lines = ["", "---", "ADVICE", ""]
    for metric in metrics:
        lines.append(f"  {metric} - {ADVICE[metric]}")
        lines.append("")
    return "\n".join(lines)
