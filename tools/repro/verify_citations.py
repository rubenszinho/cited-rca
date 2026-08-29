#!/usr/bin/env python3
"""Check that a committed review's citations resolve against committed files.

The project's central claim is that every quote in a review was copied from the
line it names. A review is only worth as much as that claim, and the claim is
only checkable if the files it cites are actually in the repository - a stray
gitignore rule once left a worked example citing telemetry that never reached a
clean clone.

This validates from the outside: it parses the rendered markdown rather than
calling any of the project's own code, so it cannot inherit the same bug.

    tools/repro/verify_citations.py examples/*/REVIEW.md
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

# `> \`source:line\`` followed by `> \`quoted text\``
CITATION = re.compile(r"^> `([^`:]+):(\d+)`\s*$\n^> `(.*)`\s*$", re.M)


def check(review: Path) -> list[str]:
    root = review.parent
    text = review.read_text(encoding="utf-8")
    problems: list[str] = []
    total = 0

    for source, lineno, quote in CITATION.findall(text):
        total += 1
        path = root / source
        if not path.exists():
            problems.append(f"{review}: {source} does not exist")
            continue
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        index = int(lineno) - 1
        if index >= len(lines):
            problems.append(f"{review}: {source}:{lineno} is past end of file")
            continue
        if quote.strip() not in lines[index]:
            problems.append(f"{review}: {source}:{lineno} does not contain its quote")

    if total == 0:
        problems.append(f"{review}: no citations found - has the format changed?")
    else:
        print(f"{review}: {total - len(problems)}/{total} citations resolve")
    return problems


def main() -> int:
    reviews = [Path(a) for a in sys.argv[1:]]
    if not reviews:
        print(__doc__, file=sys.stderr)
        return 2
    problems = [p for review in reviews for p in check(review)]
    for problem in problems:
        print(f"  {problem}", file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
