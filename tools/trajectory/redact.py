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
    # The value must look like a token. Matching any following word made this
    # rule fire on the next header name, on `Bearer ${config.apiKey}` in source,
    # and on its own placeholder - all false positives that made the
    # verification gate impossible to clear.
    (
        "bearer_header",
        re.compile(r"(?i)(authorization\s*:\s*bearer\s+)([A-Za-z0-9._~+/=-]{12,})"),
        r"\1[REDACTED:bearer]",
    ),
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


EMAIL = re.compile(r"\b([\w.+-]+)@[\w-]+\.[\w.-]+\b")

# Short local parts are ordinary words ("admin", "info", "test") and redacting
# them would shred the transcript for no privacy gain.
MIN_HANDLE = 8


def collect_handles(files: list[Path]) -> set[str]:
    """Local parts of every non-allowlisted address seen anywhere in the corpus.

    Redacting the address is not enough. A username survives on its own the
    moment anyone greps for it, types it into a command, or names a file after
    it - and a bare handle is still identifying. Collecting them corpus-wide
    first means an address seen in one session is scrubbed from every other.
    """
    handles: set[str] = set()
    for path in files:
        text = path.read_text(encoding="utf-8", errors="replace")
        for match in EMAIL.finditer(text):
            if ALLOWLIST.match(match.group(0)):
                continue
            local = match.group(1)
            if len(local) >= MIN_HANDLE:
                handles.add(local)
    return handles


def redact_handles(text: str, handles: set[str], counts: Counter) -> str:
    for handle in handles:
        pattern = re.compile(rf"\b{re.escape(handle)}\b")
        text, n = pattern.subn("[REDACTED:handle]", text)
        if n:
            counts["bare_handle"] += n
    return text


def walk(node, counts: Counter):
    if isinstance(node, str):
        return redact_text(node, counts)
    if isinstance(node, list):
        return [walk(v, counts) for v in node]
    if isinstance(node, dict):
        return {k: walk(v, counts) for k, v in node.items()}
    return node


def process_file(
    src: Path, dst: Path, counts: Counter, write: bool, handles: set[str] = frozenset()
) -> int:
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
            line_out = json.dumps(walk(rec, counts), ensure_ascii=False)
            lines_out.append(redact_handles(line_out, handles, counts))
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


# Rules that keep surrounding context, such as the bearer-header rule, leave a
# placeholder that their own pattern matches again. Stripping placeholders
# before a verification scan is what stops the check reporting its own output as
# a leak, which it can never clear.
PLACEHOLDER = re.compile(r"\[REDACTED:[a-z_]+\]")


def scan(files: list[Path]) -> Counter:
    """Count credentials that survived redaction. Writes nothing."""
    counts: Counter = Counter()
    for path in files:
        text = path.read_text(encoding="utf-8", errors="replace")
        redact_text(PLACEHOLDER.sub("", text), counts)
    return counts


def redact_all(files: list[Path], write: bool) -> tuple[Counter, int]:
    counts: Counter = Counter()
    dropped = 0
    handles = collect_handles(files)
    for src in files:
        dst = REDACTED / src.relative_to(RAW)
        dropped += process_file(src, dst, counts, write=write, handles=handles)
    return counts, dropped


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="scan the REDACTED output and exit 1 if a credential survived")
    args = ap.parse_args()

    # --check inspects what would actually be shipped. Scanning the raw logs
    # would only report what the redactor is about to remove, which always
    # looks alarming and proves nothing about the output.
    source = REDACTED if args.check else RAW
    if not source.exists():
        hint = "run `task project:trajectories:redact` first" if args.check \
            else "run `task project:trajectories` first"
        print(f"error: {source} missing; {hint}", file=sys.stderr)
        return 2
    files = sorted(source.rglob("*.jsonl"))
    if not files:
        print(f"error: no .jsonl under {source}", file=sys.stderr)
        return 2

    if args.check:
        counts = scan(files)
        report(counts, len(files), 0, True)
        # Credential rules only; a redacted-email placeholder is not a leak.
        leaks = sum(n for k, n in counts.items() if k != "email")
        print("LEAK: credentials survived redaction" if leaks
              else "clean: no credential survived redaction")
        return 1 if leaks else 0

    counts, dropped = redact_all(files, write=True)
    report(counts, len(files), dropped, False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
