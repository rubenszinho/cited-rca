"""
config.py - Quality gate configuration
======================================

WHAT THIS FILE DOES:
Parses `quality.toml` into typed Config/Scope objects. This is the file that
makes the gate framework-agnostic: thresholds, which paths to measure, and
which engine measures them are all data, not code.

ENTRY POINTS:
- `load_config(root)` -> Config

RELATED FILES:
- quality.toml (repo root, project-owned)
- tools/quality/collect.py (consumes Scope)
"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass, field
from pathlib import Path

CONFIG_FILENAME = "quality.toml"
DEFAULT_BASELINE_FILENAME = ".quality-baseline.json"

# Metrics measured per function. `file_lines` is measured per file by the
# core itself, so it works even for a language no engine can parse.
FUNCTION_METRICS = ("nloc", "ccn", "params")
THRESHOLD_METRICS = (*FUNCTION_METRICS, "file_lines")

BUILTIN_ENGINES = ("lizard", "none")


@dataclass(frozen=True)
class Scope:
    """One measured slice of the repo."""

    name: str
    path: str
    extensions: tuple[str, ...]
    excludes: tuple[str, ...] = ()
    engine: str = "lizard"
    languages: tuple[str, ...] = ()
    adapter: str | None = None


@dataclass(frozen=True)
class Config:
    """Parsed quality.toml."""

    thresholds: dict[str, int] = field(default_factory=dict)
    scopes: tuple[Scope, ...] = ()
    baseline_filename: str = DEFAULT_BASELINE_FILENAME


def load_config(root: Path, config_path: Path | None = None) -> Config:
    """Read and validate quality.toml.

    Example: cfg = load_config(Path.cwd())
    """
    path = config_path or root / CONFIG_FILENAME
    if not path.exists():
        raise FileNotFoundError(
            f"quality config not found: {path}. Expected a TOML file with a "
            "[thresholds] table and at least one [[scope]] table."
        )
    raw = tomllib.loads(path.read_text())
    baseline = raw.get("baseline", {})
    return Config(
        thresholds=_parse_thresholds(raw.get("thresholds"), path),
        scopes=tuple(_parse_scope(s, path) for s in _require_scopes(raw, path)),
        baseline_filename=baseline.get("path", DEFAULT_BASELINE_FILENAME),
    )


def _parse_thresholds(raw: object, path: Path) -> dict[str, int]:
    if not isinstance(raw, dict):
        raise ValueError(
            f"{path}: [thresholds] must be a table, got {type(raw).__name__}. "
            f"Expected keys: {', '.join(THRESHOLD_METRICS)}."
        )
    _reject_unknown_keys(raw, THRESHOLD_METRICS, path, "[thresholds]")
    return {m: _positive_int(raw, m, path) for m in THRESHOLD_METRICS}


def _positive_int(raw: dict[str, object], key: str, path: Path) -> int:
    value = raw.get(key)
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise ValueError(
            f"{path}: [thresholds].{key} must be a positive integer, got {value!r}."
        )
    return value


def _require_scopes(raw: dict[str, object], path: Path) -> list[dict[str, object]]:
    scopes = raw.get("scope")
    if not isinstance(scopes, list) or not scopes:
        raise ValueError(
            f"{path}: at least one [[scope]] table is required, got {scopes!r}. "
            'Expected: [[scope]] with name, path and extensions = [".py"].'
        )
    return scopes


def _parse_scope(raw: dict[str, object], path: Path) -> Scope:
    _reject_unknown_keys(raw, _SCOPE_KEYS, path, "[[scope]]")
    name = _require_str(raw, "name", path)
    engine, adapter = _parse_engine(raw, name, path)
    return Scope(
        name=name,
        path=_require_str(raw, "path", path),
        extensions=_require_str_list(raw, "extensions", name, path),
        excludes=tuple(raw.get("excludes", ()) or ()),
        engine=engine,
        languages=_parse_languages(raw),
        adapter=adapter,
    )


_SCOPE_KEYS = (
    "name", "path", "extensions", "excludes", "engine", "language",
    "languages", "adapter",
)


def _parse_engine(raw: dict[str, object], name: str, path: Path) -> tuple[str, str | None]:
    """An explicit adapter always wins; otherwise engine must be built in."""
    adapter = raw.get("adapter")
    if adapter is not None:
        if not isinstance(adapter, str) or not adapter:
            raise ValueError(
                f"{path}: scope {name!r} adapter must be a non-empty path, got {adapter!r}."
            )
        return "adapter", adapter
    engine = raw.get("engine", "lizard")
    if engine not in BUILTIN_ENGINES:
        raise ValueError(
            f"{path}: scope {name!r} engine={engine!r} is not built in. "
            f"Expected one of {BUILTIN_ENGINES}, or set adapter = <path>."
        )
    return engine, None


def _parse_languages(raw: dict[str, object]) -> tuple[str, ...]:
    """`language = "x"` and `languages = ["x", "y"]` are both accepted.

    Two entries means the scope is scanned twice — the idiom for a parser
    that needs a different mode per dialect (e.g. typescript and tsx).
    """
    if "languages" in raw:
        return tuple(raw["languages"] or ())
    single = raw.get("language")
    return (single,) if isinstance(single, str) and single else ()


def _require_str(raw: dict[str, object], key: str, path: Path) -> str:
    value = raw.get(key)
    if not isinstance(value, str) or not value:
        raise ValueError(
            f"{path}: [[scope]].{key} must be a non-empty string, got {value!r}."
        )
    return value


def _require_str_list(
    raw: dict[str, object], key: str, name: str, path: Path,
) -> tuple[str, ...]:
    value = raw.get(key)
    if not isinstance(value, list) or not value:
        raise ValueError(
            f"{path}: scope {name!r} {key} must be a non-empty list, got {value!r}. "
            'Expected e.g. [".py", ".pyi"].'
        )
    return tuple(value)


def _reject_unknown_keys(
    raw: dict[str, object], allowed: tuple[str, ...], path: Path, table: str,
) -> None:
    """Typos in a config that silently does nothing are worse than a crash."""
    unknown = sorted(set(raw) - set(allowed))
    if unknown:
        raise ValueError(
            f"{path}: unknown key(s) in {table}: {', '.join(unknown)}. "
            f"Allowed: {', '.join(allowed)}."
        )
