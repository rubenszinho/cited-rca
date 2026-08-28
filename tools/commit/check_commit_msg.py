"""
check_commit_msg.py - Conventional commit validation
====================================================

WHAT THIS FILE DOES:
Validates a commit message file against commit.toml. Stdlib only, so a
project does not need npm (or any other ecosystem) just to lint a commit
subject.

ENTRY POINT:
- `python3 -m tools.commit.check_commit_msg <path-to-COMMIT_EDITMSG>`
  git passes that path to the commit-msg hook as its first argument.

RULES:
- header shape `type(scope)!: subject`, scope and `!` optional
- type from the configured list; a short list beats an exhaustive one
- scope from the configured list when that list is non-empty
- subject: starts lowercase, no trailing period, length capped
- a body must be separated from the header by one blank line

RELATED FILES:
- commit.toml (project-owned), lefthook.yml (commit-msg hook)
"""

from __future__ import annotations

import argparse
import re
import sys
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

CONFIG_FILENAME = "commit.toml"

HEADER_PATTERN = re.compile(
    r"^(?P<type>[a-z]+)"
    r"(?:\((?P<scope>[^()]+)\))?"
    r"(?P<breaking>!)?"
    r": (?P<subject>.+)$"
)

# git inserts these itself; linting them only blocks legitimate merges.
IGNORED_PREFIXES = ("Merge ", "Revert ", "fixup!", "squash!")

DEFAULT_TYPES = ("feat", "fix", "chore", "docs", "revert")


@dataclass(frozen=True)
class CommitRules:
    types: tuple[str, ...] = DEFAULT_TYPES
    scopes: tuple[str, ...] = ()
    scope_required: bool = False
    subject_max_length: int = 72


@dataclass
class Result:
    errors: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


def load_rules(root: Path, config_path: Path | None = None) -> CommitRules:
    """Read commit.toml, falling back to the defaults when it is absent."""
    path = config_path or root / CONFIG_FILENAME
    if not path.exists():
        return CommitRules()
    raw = tomllib.loads(path.read_text())
    return CommitRules(
        types=tuple(raw.get("types", DEFAULT_TYPES)),
        scopes=tuple(raw.get("scopes", ())),
        scope_required=bool(raw.get("scope_required", False)),
        subject_max_length=int(raw.get("subject_max_length", 72)),
    )


def strip_comments(message: str) -> str:
    """Drop git's comment lines and the diff it appends under --verbose."""
    lines: list[str] = []
    for line in message.splitlines():
        if line.startswith("#"):
            continue
        if line.startswith("diff --git "):
            break
        lines.append(line)
    return "\n".join(lines).strip("\n")


def validate(message: str, rules: CommitRules) -> Result:
    """Check one commit message.

    Example: validate("feat(api): add health route", CommitRules())
    """
    result = Result()
    body = strip_comments(message)
    if not body.strip():
        result.errors.append("commit message is empty.")
        return result
    lines = body.splitlines()
    header = lines[0]
    if header.startswith(IGNORED_PREFIXES):
        return result
    match = HEADER_PATTERN.match(header)
    if match is None:
        result.errors.append(_shape_error(header, rules))
        return result
    _check_type(match.group("type"), rules, result)
    _check_scope(match.group("scope"), rules, result)
    _check_subject(match.group("subject"), rules, result)
    _check_body_separation(lines, result)
    return result


def _shape_error(header: str, rules: CommitRules) -> str:
    return (
        f"header does not match `type(scope): subject`: {header!r}. "
        f"Expected e.g. {rules.types[0]}(scope): add the thing"
    )


def _check_type(value: str, rules: CommitRules, result: Result) -> None:
    if value not in rules.types:
        result.errors.append(
            f"type {value!r} is not allowed. Allowed: {', '.join(rules.types)}."
        )


def _check_scope(value: str | None, rules: CommitRules, result: Result) -> None:
    if value is None:
        if rules.scope_required:
            result.errors.append(
                f"scope is required. Allowed: {', '.join(rules.scopes) or '<any>'}."
            )
        return
    if rules.scopes and value not in rules.scopes:
        result.errors.append(
            f"scope {value!r} is not allowed. Allowed: {', '.join(rules.scopes)}."
        )


def _check_subject(subject: str, rules: CommitRules, result: Result) -> None:
    if len(subject) > rules.subject_max_length:
        result.errors.append(
            f"subject is {len(subject)} chars, max is {rules.subject_max_length}: "
            f"{subject!r}."
        )
    if subject.endswith("."):
        result.errors.append(f"subject must not end with a period: {subject!r}.")
    if subject[:1].isupper():
        result.errors.append(f"subject must start lowercase: {subject!r}.")


def _check_body_separation(lines: list[str], result: Result) -> None:
    if len(lines) > 1 and lines[1].strip():
        result.errors.append(
            f"body must be separated from the header by a blank line, got "
            f"{lines[1]!r} on line 2."
        )


def render_result(result: Result, header: str) -> str:
    if result.ok:
        return "PASS  Commit message.\n\nExit 0.\n"
    lines = [f"FAIL  Commit message: {len(result.errors)} problem(s).\n", ""]
    lines.append(f"  {header}")
    lines.append("")
    lines += [f"  - {error}" for error in result.errors]
    lines.append("")
    lines.append("Exit 1.")
    return "\n".join(lines) + "\n"


def main(argv: list[str], cwd: Path | None = None) -> int:
    """CLI entry point. `cwd` is injectable so tests can run in a tmpdir."""
    cwd = cwd or Path.cwd()
    parser = argparse.ArgumentParser(prog="check_commit_msg")
    parser.add_argument("message_file", type=Path, help="Path to COMMIT_EDITMSG.")
    parser.add_argument("--config", type=Path, default=None)
    args = parser.parse_args(argv)
    message = args.message_file.read_text()
    result = validate(message, load_rules(cwd, args.config))
    header = strip_comments(message).splitlines()[0] if strip_comments(message) else ""
    print(render_result(result, header), end="")
    return 0 if result.ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
