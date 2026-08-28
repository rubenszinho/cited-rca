"""
collect.py - Measurement
========================

WHAT THIS FILE DOES:
Turns configured scopes into a Snapshot: per-function nloc/ccn/params plus
per-file line counts. Two engines are built in (`lizard`, `none`); anything
else is an external adapter.

ADAPTER CONTRACT:
An adapter is any executable invoked as `adapter <file> <file> ...` with
sorted absolute paths. It writes one JSON object per line to stdout:
  {"file": "src/a.py", "function": "parse", "nloc": 12, "ccn": 3, "params": 2}
`file` may be absolute or repo-relative. Missing metrics are treated as
absent, not zero. Unknown keys are ignored. Non-zero exit is fatal.

DESIGN NOTES:
- Files are sorted before the engine sees them. Some parsers carry state
  across files, so an unsorted list produces different numbers on different
  filesystems and quietly corrupts the baseline.
- Same-name functions in one file collapse to the worst value per metric.
"""

from __future__ import annotations

import csv as _csv
import io
import json
import subprocess
from pathlib import Path
from typing import TypedDict

from tools.quality.config import Config, Scope


class Record(TypedDict):
    """One measured function."""

    file: str
    function: str
    nloc: int
    ccn: int
    params: int


class FunctionEntry(TypedDict):
    nloc: int
    ccn: int
    params: int


class FileEntry(TypedDict):
    file_lines: int
    functions: dict[str, FunctionEntry]


class Snapshot(TypedDict):
    version: int
    thresholds: dict[str, int]
    files: dict[str, FileEntry]


SNAPSHOT_VERSION = 1

# lizard --csv column order:
# nloc, ccn, tokens, params, length, location, file, name, long_name,
# start_line, end_line
_LIZARD_MIN_COLUMNS = 11


def collect_snapshot(root: Path, config: Config) -> Snapshot:
    """Measure every configured scope and merge into one snapshot.

    Example: snap = collect_snapshot(Path.cwd(), load_config(Path.cwd()))
    """
    files: dict[str, FileEntry] = {}
    for scope in config.scopes:
        paths = iter_scope_files(root, scope)
        if not paths:
            continue
        _merge_records(files, measure_scope(root, scope, paths), root)
        _merge_file_lines(files, count_file_lines(root, paths))
    return Snapshot(
        version=SNAPSHOT_VERSION,
        thresholds=dict(config.thresholds),
        files=files,
    )


def iter_scope_files(root: Path, scope: Scope) -> list[Path]:
    """Sorted list of files in the scope, after extension and exclude filters."""
    scope_root = root / scope.path
    if not scope_root.exists():
        return []
    return sorted(
        path
        for path in scope_root.rglob("*")
        if path.is_file()
        and path.suffix in scope.extensions
        and not _is_excluded(relative_to(path, root), scope.excludes)
    )


def relative_to(path: Path, root: Path) -> str:
    """Repo-relative POSIX path, or the path itself when outside the repo."""
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def _is_excluded(rel_path: str, excludes: tuple[str, ...]) -> bool:
    return any(pattern in rel_path for pattern in excludes)


def count_file_lines(root: Path, paths: list[Path]) -> dict[str, int]:
    """Repo-relative path -> line count, with `wc -l` semantics."""
    counts: dict[str, int] = {}
    for path in paths:
        try:
            with open(path, "rb") as handle:
                counts[relative_to(path, root)] = sum(1 for _ in handle)
        except OSError:
            continue
    return counts


def measure_scope(root: Path, scope: Scope, paths: list[Path]) -> list[Record]:
    """Dispatch a scope to its engine or adapter."""
    if scope.engine == "none":
        return []
    if scope.engine == "adapter":
        return run_adapter(root, str(root / scope.adapter), paths)
    return _run_lizard_languages(scope, paths)


def _run_lizard_languages(scope: Scope, paths: list[Path]) -> list[Record]:
    """Scan once per configured language; no language means let lizard infer."""
    languages: tuple[str | None, ...] = scope.languages or (None,)
    records: list[Record] = []
    for language in languages:
        records.extend(run_lizard(paths, language))
    return records


def run_lizard(paths: list[Path], language: str | None) -> list[Record]:
    """Invoke the pinned lizard CLI over sorted paths and parse its CSV."""
    command = ["lizard", *(str(p) for p in paths), "--csv"]
    if language:
        command.extend(["-l", language])
    proc = subprocess.run(command, capture_output=True, text=True, check=False)
    return parse_lizard_csv(proc.stdout)


def parse_lizard_csv(stdout: str) -> list[Record]:
    """Parse lizard --csv output. Malformed or short rows are skipped."""
    records: list[Record] = []
    for parts in _csv.reader(io.StringIO(stdout)):
        if len(parts) < _LIZARD_MIN_COLUMNS:
            continue
        try:
            records.append(Record(
                file=parts[6],
                function=parts[7],
                nloc=int(parts[0]),
                ccn=int(parts[1]),
                params=int(parts[3]),
            ))
        except ValueError:
            continue
    return records


def run_adapter(root: Path, adapter: str, paths: list[Path]) -> list[Record]:
    """Run an external adapter and parse its NDJSON output."""
    command = [adapter, *(str(p) for p in paths)]
    proc = subprocess.run(
        command, capture_output=True, text=True, check=False, cwd=root,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"adapter {adapter} exited {proc.returncode}. stderr: "
            f"{proc.stderr.strip()[:500]!r}"
        )
    return parse_adapter_ndjson(proc.stdout, adapter)


def parse_adapter_ndjson(stdout: str, adapter: str) -> list[Record]:
    """Parse one JSON object per line. Blank lines are ignored."""
    records: list[Record] = []
    for number, line in enumerate(stdout.splitlines(), start=1):
        if not line.strip():
            continue
        records.append(_adapter_record(line, adapter, number))
    return records


def _adapter_record(line: str, adapter: str, number: int) -> Record:
    try:
        payload = json.loads(line)
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"adapter {adapter} line {number}: not valid JSON: {line[:200]!r}. "
            'Expected {"file": str, "function": str, "nloc": int, "ccn": int, '
            '"params": int}.'
        ) from exc
    return Record(
        file=_require_field(payload, "file", adapter, number),
        function=_require_field(payload, "function", adapter, number),
        nloc=_metric(payload, "nloc"),
        ccn=_metric(payload, "ccn"),
        params=_metric(payload, "params"),
    )


def _require_field(payload: dict[str, object], key: str, adapter: str, number: int) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value:
        raise ValueError(
            f"adapter {adapter} line {number}: {key!r} must be a non-empty "
            f"string, got {value!r}."
        )
    return value


def _metric(payload: dict[str, object], key: str) -> int:
    """An absent metric records as 0 — it can never trip a threshold."""
    value = payload.get(key, 0)
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def _merge_records(
    files: dict[str, FileEntry], records: list[Record], root: Path,
) -> None:
    for record in records:
        rel = relative_to(Path(record["file"]), root)
        entry = files.setdefault(rel, FileEntry(file_lines=0, functions={}))
        current = FunctionEntry(
            nloc=record["nloc"], ccn=record["ccn"], params=record["params"],
        )
        existing = entry["functions"].get(record["function"])
        entry["functions"][record["function"]] = (
            worst(existing, current) if existing else current
        )


def worst(left: FunctionEntry, right: FunctionEntry) -> FunctionEntry:
    """Collapse a name collision to its worst value per metric.

    Overloads, `__init__` across classes and anonymous arrow functions all
    share a name within a file; the strictest reading is the safe one.
    """
    return FunctionEntry(
        nloc=max(left["nloc"], right["nloc"]),
        ccn=max(left["ccn"], right["ccn"]),
        params=max(left["params"], right["params"]),
    )


def _merge_file_lines(files: dict[str, FileEntry], counts: dict[str, int]) -> None:
    for rel, lines in counts.items():
        entry = files.setdefault(rel, FileEntry(file_lines=0, functions={}))
        entry["file_lines"] = lines
