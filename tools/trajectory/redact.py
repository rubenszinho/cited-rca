#!/usr/bin/env python3
"""Redact secrets from Claude Code session logs before they are submitted.

Raw trajectories are verbatim session transcripts. If any command during the
sprint printed a .env file, exported a key, or echoed a token, that value is
sitting in the JSONL. Publishing them unredacted would leak live credentials,
so this pass runs before anything is packaged or committed.

The redactor walks every string in every JSON record and rewrites matches in
place, keeping the record structure intact so the logs stay valid JSONL and
remain reviewable by the judges.

Usage:
    scripts/redact-trajectories.py                 # raw/ -> redacted/
    scripts/redact-trajectories.py --check         # scan only, non-zero on hit
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
RAW = REPO_ROOT / "trajectories" / "raw"
REDACTED = REPO_ROOT / "trajectories" / "redacted"

# (name, compiled pattern, replacement). Order matters: specific before generic.
RULES: list[tuple[str, re.Pattern[str], str]] = [
    ("anthropic_key", re.compile(r"sk-ant-[A-Za-z0-9_\-]{20,}"), "[REDACTED:anthropic_key]"),
    ("openai_key", re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_\-]{20,}"), "[REDACTED:openai_key]"),
    ("github_pat", re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}"), "[REDACTED:github_pat]"),
    ("github_fine", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{50,}"), "[REDACTED:github_pat]"),
    ("aws_key_id", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"), "[REDACTED:aws_key_id]"),
    ("google_key", re.compile(r"\bAIza[0-9A-Za-z_\-]{35}\b"), "[REDACTED:google_key]"),
    ("slack_token", re.compile(r"\bxox[abprs]-[A-Za-z0-9\-]{10,}"), "[REDACTED:slack_token]"),
    ("openrouter_key", re.compile(r"\bsk-or-v1-[a-f0-9]{40,}"), "[REDACTED:openrouter_key]"),
    ("private_key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----", re.S), "[REDACTED:private_key]"),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}"), "[REDACTED:jwt]"),
    ("bearer_header", re.compile(r"(?i)(authorization\s*:\s*bearer\s+)\S+"), r"\1[REDACTED:bearer]"),
    # KEY=value / KEY: value where the name reads like a credential. Catches the
    # common case of a .env being cat'd or an export being echoed.
    (
        "env_assignment",
        re.compile(
            r"(?im)^([A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|API_?KEY)[A-Z0-9_]*)"
            r"(\s*[:=]\s*)(?!\s*$)([\"']?)([^\s\"'\n]{8,})\3"
        ),
        r"\1\2[REDACTED:env]",
    ),
    ("email", re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b"), "[REDACTED:email]"),
]

# Values that look like secrets by shape but are public / harmless.
ALLOWLIST = re.compile(
    r"^(?:yeison@micro1\.ai|noreply@anthropic\.com)$"
)


def redact_text(text: str, counts: Counter) -> str:
    for name, pattern, replacement in RULES:
        if name == "email":
            def _email(m: re.Match[str]) -> str:
                if ALLOWLIST.match(m.group(0)):
                    return m.group(0)
                counts[name] += 1
                return replacement
            text = pattern.sub(_email, text)
            continue
        text, n = pattern.subn(replacement, text)
        if n:
            counts[name] += n
    return text


def walk(node, counts: Counter):
    if isinstance(node, str):
        return redact_text(node, counts)
    if isinstance(node, list):
        return [walk(v, counts) for v in node]
    if isinstance(node, dict):
        return {k: walk(v, counts) for k, v in node.items()}
    return node


def process_file(src: Path, dst: Path, counts: Counter, write: bool) -> int:
    lines_out: list[str] = []
    bad = 0
    with src.open(encoding="utf-8", errors="replace") as fh:
        for lineno, line in enumerate(fh, 1):
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                # Never pass through a record we could not parse and therefore
                # could not redact.
                print(f"warn: {src.name}:{lineno} unparseable, dropping", file=sys.stderr)
                bad += 1
                continue
            lines_out.append(json.dumps(walk(rec, counts), ensure_ascii=False))
    if write:
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_text("\n".join(lines_out) + "\n", encoding="utf-8")
    return bad


def report(counts: Counter, file_count: int, dropped: int, check: bool) -> None:
    destination = "(check only)" if check else str(REDACTED)
    print(f"files: {file_count}  -> {destination}")
    for name, n in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"  {name:18} {n}")
    if not counts:
        print("  no matches")
    if dropped:
        print(f"  unparseable records dropped: {dropped}", file=sys.stderr)


def redact_all(files: list[Path], write: bool) -> tuple[Counter, int]:
    counts: Counter = Counter()
    dropped = 0
    for src in files:
        dst = REDACTED / src.relative_to(RAW)
        dropped += process_file(src, dst, counts, write=write)
    return counts, dropped


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="scan without writing; exit 1 if any secret was found")
    args = ap.parse_args()

    if not RAW.exists():
        print(f"error: {RAW} missing; run `task trajectories:capture` first", file=sys.stderr)
        return 2
    files = sorted(RAW.rglob("*.jsonl"))
    if not files:
        print(f"error: no .jsonl under {RAW}", file=sys.stderr)
        return 2

    counts, dropped = redact_all(files, write=not args.check)
    report(counts, len(files), dropped, args.check)

    if args.check:
        # Credential rules only; an email match is expected and not a failure.
        return 1 if sum(n for k, n in counts.items() if k != "email") else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
