"""
diff.py - Ratchet rules
=======================

WHAT THIS FILE DOES:
Compares a fresh snapshot against the baseline and sorts every difference
into one of three buckets.

THE RULES:
- A function recorded in the baseline is gated on its BASELINE value.
  Exceeding it is a regression.
- A function absent from the baseline is gated on the STRICT thresholds —
  including a brand new function inside a grandfathered legacy file. The
  baseline grandfathers functions, never files.
- Any metric better than the baseline is an improvement, and improvements
  are mandatory to record: the baseline must be regenerated and committed.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TypedDict

from tools.quality.baseline import Baseline
from tools.quality.collect import FileEntry, FunctionEntry, Snapshot
from tools.quality.config import FUNCTION_METRICS


@dataclass(frozen=True)
class Located:
    """A file, or one function within a file."""

    file: str
    function: str | None = None


class Violation(TypedDict):
    file: str
    function: str | None  # None for a file-length violation
    metrics: dict[str, tuple[int, int]]  # metric -> (current, gate)


class Improvement(TypedDict):
    file: str
    function: str | None
    metrics: dict[str, tuple[int, int]]  # metric -> (current, baseline)
    removed: bool  # the function or file disappeared


class Diff(TypedDict):
    new_violations: list[Violation]
    regressions: list[Violation]
    improvements: list[Improvement]


def compute_diff(
    snapshot: Snapshot, baseline: Baseline | None, thresholds: dict[str, int],
) -> Diff:
    """Categorise every difference between snapshot and baseline.

    Example: diff = compute_diff(snap, load_baseline(p), cfg.thresholds)
    """
    diff: Diff = {"new_violations": [], "regressions": [], "improvements": []}
    baseline_files = baseline["files"] if baseline else {}
    for path, entry in snapshot["files"].items():
        _diff_file(diff, path, entry, baseline_files.get(path), thresholds)
    _diff_deleted_files(diff, snapshot, baseline_files, thresholds)
    return diff


def _diff_file(
    diff: Diff,
    path: str,
    entry: FileEntry,
    baseline_entry: FileEntry | None,
    thresholds: dict[str, int],
) -> None:
    _diff_file_length(diff, path, entry, baseline_entry, thresholds)
    baseline_funcs = baseline_entry["functions"] if baseline_entry else {}
    for name, fn in entry["functions"].items():
        ref = Located(file=path, function=name)
        _diff_function(diff, ref, fn, baseline_funcs.get(name), thresholds)
    for name in baseline_funcs:
        if name not in entry["functions"]:
            diff["improvements"].append(_removed(path, name))


def _diff_file_length(
    diff: Diff,
    path: str,
    entry: FileEntry,
    baseline_entry: FileEntry | None,
    thresholds: dict[str, int],
) -> None:
    """Length is ratcheted only for files ALREADY past the limit.

    A file lands in the baseline as soon as one of its functions is too
    complex, and its length is recorded alongside. Gating on that recorded
    number would freeze a perfectly compliant 16-line file at 16 lines and
    read every later addition as a regression.
    """
    current = entry["file_lines"]
    limit = thresholds["file_lines"]
    recorded = baseline_entry["file_lines"] if baseline_entry else None
    if recorded is None or recorded <= limit:
        if current > limit:
            diff["new_violations"].append(
                _violation(path, None, {"file_lines": (current, limit)})
            )
        return
    if current > recorded:
        diff["regressions"].append(
            _violation(path, None, {"file_lines": (current, recorded)})
        )
    elif current < recorded:
        diff["improvements"].append(
            _improvement(path, None, {"file_lines": (current, recorded)})
        )


def _diff_function(
    diff: Diff,
    ref: Located,
    current: FunctionEntry,
    recorded: FunctionEntry | None,
    thresholds: dict[str, int],
) -> None:
    if recorded is None:
        over = _exceeded(current, thresholds)
        if over:
            diff["new_violations"].append(_violation(ref.file, ref.function, over))
        return
    regressed, improved = _compare(current, recorded)
    if regressed:
        diff["regressions"].append(_violation(ref.file, ref.function, regressed))
    if improved:
        diff["improvements"].append(_improvement(ref.file, ref.function, improved))


def _exceeded(
    current: FunctionEntry, thresholds: dict[str, int],
) -> dict[str, tuple[int, int]]:
    return {
        metric: (current[metric], thresholds[metric])
        for metric in FUNCTION_METRICS
        if current[metric] > thresholds[metric]
    }


def _compare(
    current: FunctionEntry, recorded: FunctionEntry,
) -> tuple[dict[str, tuple[int, int]], dict[str, tuple[int, int]]]:
    """(regressed, improved) metric maps for one grandfathered function."""
    regressed: dict[str, tuple[int, int]] = {}
    improved: dict[str, tuple[int, int]] = {}
    for metric in FUNCTION_METRICS:
        if current[metric] > recorded[metric]:
            regressed[metric] = (current[metric], recorded[metric])
        elif current[metric] < recorded[metric]:
            improved[metric] = (current[metric], recorded[metric])
    return regressed, improved


def _diff_deleted_files(
    diff: Diff,
    snapshot: Snapshot,
    baseline_files: dict[str, FileEntry],
    thresholds: dict[str, int],
) -> None:
    """Deleting a baselined file is an improvement, one entry per record."""
    for path, entry in baseline_files.items():
        if path in snapshot["files"]:
            continue
        for name in entry["functions"]:
            diff["improvements"].append(_removed(path, name))
        if entry["file_lines"] > thresholds["file_lines"]:
            diff["improvements"].append(_removed(path, None))


def _violation(
    path: str, function: str | None, metrics: dict[str, tuple[int, int]],
) -> Violation:
    return Violation(file=path, function=function, metrics=metrics)


def _improvement(
    path: str, function: str | None, metrics: dict[str, tuple[int, int]],
) -> Improvement:
    return Improvement(file=path, function=function, metrics=metrics, removed=False)


def _removed(path: str, function: str | None) -> Improvement:
    return Improvement(file=path, function=function, metrics={}, removed=True)


def has_failures(diff: Diff) -> bool:
    """True when the run must fail regardless of mode."""
    return bool(diff["regressions"] or diff["new_violations"])
