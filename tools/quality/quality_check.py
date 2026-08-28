"""
quality_check.py - Code quality ratchet
=======================================

WHAT THIS FILE DOES:
A one-way ratchet over four metrics (nloc, ccn, params, file_lines). Existing
violations are grandfathered in a committed baseline; new code is held to the
strict thresholds. The gate can only get tighter, and any attempt to loosen it
appears as a baseline diff in review.

ENTRY POINTS:
- `python3 -m tools.quality.quality_check check`           read-only (CI)
- `python3 -m tools.quality.quality_check check --write`   local, absorbs improvements
- `python3 -m tools.quality.quality_check generate-baseline [--force]`
- `python3 -m tools.quality.quality_check print-thresholds`

WHY LOCAL AND CI DIFFER:
Local runs pass --write, so an improvement rewrites the baseline and passes.
CI runs without it, so the same improvement fails as a stale baseline. That
asymmetry is what forces a refactor to commit its regenerated baseline
instead of leaving the recorded numbers drifting behind reality.

DEPENDENCIES:
- Python 3.11+ stdlib (tomllib)
- whatever engine the scopes use; the built-in default is the `lizard` CLI

RELATED FILES:
- quality.toml, .quality-baseline.json
- Taskfile.yml (`task quality:check`, `task ci:quality`)
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from tools.quality.baseline import (
    count_entries,
    filter_to_violators,
    load_baseline,
    save_baseline,
)
from tools.quality.collect import collect_snapshot
from tools.quality.config import THRESHOLD_METRICS, Config, load_config
from tools.quality.diff import compute_diff, has_failures
from tools.quality.report import render


def _cmd_check(*, write: bool, cwd: Path, config: Config) -> int:
    baseline_path = cwd / config.baseline_filename
    snapshot = collect_snapshot(cwd, config)
    diff = compute_diff(snapshot, load_baseline(baseline_path), config.thresholds)

    absorb = write and not has_failures(diff) and bool(diff["improvements"])
    if absorb:
        save_baseline(baseline_path, filter_to_violators(snapshot, config.thresholds))

    text, exit_code = render(
        diff,
        mode="local" if write else "ci",
        baseline_was_written=absorb,
        thresholds=config.thresholds,
    )
    print(text, end="")
    return exit_code


def _cmd_generate_baseline(*, force: bool, cwd: Path, config: Config) -> int:
    baseline_path = cwd / config.baseline_filename
    if baseline_path.exists() and not force:
        print(
            f"FAIL  {config.baseline_filename} already exists. "
            "Pass --force to overwrite.\n\nExit 1.\n",
            end="",
        )
        return 1
    baseline = filter_to_violators(
        collect_snapshot(cwd, config), config.thresholds,
    )
    save_baseline(baseline_path, baseline)
    files, functions = count_entries(baseline)
    print(
        f"PASS  Baseline generated: {files} file(s) / {functions} function(s) "
        f"grandfathered.\n      Written to {config.baseline_filename}.\n\nExit 0.\n",
        end="",
    )
    return 0


def _cmd_print_thresholds(*, config: Config) -> int:
    """Emit `metric=value` lines so docs can be diffed against the real gate."""
    for metric in THRESHOLD_METRICS:
        print(f"{metric}={config.thresholds[metric]}")
    return 0


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="quality_check", description="Code quality ratchet.",
    )
    parser.add_argument("--config", type=Path, default=None, help="Path to quality.toml.")
    sub = parser.add_subparsers(dest="cmd", required=True)
    check = sub.add_parser("check", help="Check thresholds against the baseline.")
    check.add_argument(
        "--write", action="store_true", help="Absorb improvements into the baseline.",
    )
    generate = sub.add_parser(
        "generate-baseline", help="Bootstrap a baseline from the current state.",
    )
    generate.add_argument(
        "--force", action="store_true", help="Overwrite an existing baseline.",
    )
    sub.add_parser("print-thresholds", help="Print metric=value for every threshold.")
    return parser


def main(argv: list[str], cwd: Path | None = None) -> int:
    """CLI entry point. `cwd` is injectable so tests can run in a tmpdir."""
    cwd = cwd or Path.cwd()
    args = _build_parser().parse_args(argv)
    config = load_config(cwd, args.config)
    if args.cmd == "check":
        return _cmd_check(write=args.write, cwd=cwd, config=config)
    if args.cmd == "generate-baseline":
        return _cmd_generate_baseline(force=args.force, cwd=cwd, config=config)
    return _cmd_print_thresholds(config=config)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
