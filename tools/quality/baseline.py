"""
baseline.py - Baseline I/O
==========================

WHAT THIS FILE DOES:
Reads and writes .quality-baseline.json, the committed record of
grandfathered violations. A missing baseline means strict mode for
everything — a fresh project is held to the thresholds from commit one.

DESIGN NOTES:
- Written with sorted keys and a 2-space indent so a real change to the
  gate shows up as a small, readable diff in review.
- Only violating entries are stored, but a stored function keeps ALL of its
  metrics, so a grandfathered function cannot quietly degrade a metric that
  is currently compliant.
"""

from __future__ import annotations

import json
from pathlib import Path

from tools.quality.collect import FileEntry, Snapshot
from tools.quality.config import FUNCTION_METRICS

# A baseline has the same shape as a snapshot.
Baseline = Snapshot


def save_baseline(path: Path, baseline: Baseline) -> None:
    """Write the baseline as deterministic JSON."""
    path.write_text(json.dumps(baseline, indent=2, sort_keys=True) + "\n")


def load_baseline(path: Path) -> Baseline | None:
    """Load the baseline, or None when the file does not exist."""
    if not path.exists():
        return None
    return json.loads(path.read_text())


def function_violates(entry: dict[str, int], thresholds: dict[str, int]) -> bool:
    """True when any function metric exceeds its strict threshold."""
    return any(entry[metric] > thresholds[metric] for metric in FUNCTION_METRICS)


def filter_to_violators(snapshot: Snapshot, thresholds: dict[str, int]) -> Baseline:
    """Reduce a snapshot to the entries that breach strict thresholds.

    A file is kept when it is over the line limit or holds at least one
    violating function; within a kept file only violating functions are
    recorded.
    """
    files: dict[str, FileEntry] = {}
    for path, entry in snapshot["files"].items():
        violators = {
            name: fn
            for name, fn in entry["functions"].items()
            if function_violates(fn, thresholds)
        }
        over_limit = entry["file_lines"] > thresholds["file_lines"]
        if over_limit or violators:
            files[path] = FileEntry(
                file_lines=entry["file_lines"], functions=violators,
            )
    return Baseline(
        version=snapshot["version"], thresholds=dict(thresholds), files=files,
    )


def count_entries(baseline: Baseline) -> tuple[int, int]:
    """(files, functions) recorded in the baseline."""
    files = len(baseline["files"])
    functions = sum(len(e["functions"]) for e in baseline["files"].values())
    return files, functions
