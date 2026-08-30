"""Bind each quoted figure to the metric and variant it is a figure *of*.

`verify_claims.py` asks only "did some run somewhere produce this value?". That
caught fabricated numbers and nothing else, and three real defects walked
through it:

  - a paired block labelled "withtriage minus shipped" carrying the *memory*
    comparison's numbers, which are legitimate values of the other comparison;
  - src/agent/features.ts explaining every rejection with superseded three-seed
    figures that now argue the opposite way, in a file the gate never read;
  - two submitted documents stating different numbers for the same comparison.

Every one of those is a number that exists but does not belong to the claim
around it. So this module reads the label: for each figure it finds the nearest
metric word to its left and the variants named on the line, and requires the
number to be that metric's value for one of those variants. A figure whose
context does not identify both falls back to the existence check - the point is
to bind what can be bound, not to force prose into a schema.
"""

from __future__ import annotations

import json
import re
import statistics
from collections import defaultdict
from pathlib import Path

RESULTS = Path(__file__).resolve().parent.parent.parent / "results"

# Prose names for each variant. Longest match wins, so "no search" beats "search".
VARIANTS = {
    "baseline": "baseline",
    "nosearch": "agent-nosearch",
    "no search": "agent-nosearch",
    "without search": "agent-nosearch",
    "noverify": "agent-noverify",
    "no verifier": "agent-noverify",
    "withtriage": "agent-withtriage",
    "triage": "agent-withtriage",
    "planning": "agent-withtriage",
    "memory": "agent-memory",
    "investigate": "agent-investigate",
    "investigation": "agent-investigate",
    "shipped": "agent",
    "agent": "agent",
}

# Prose names for each metric.
METRICS = {
    "pass rate": "pass_rate",
    "pass": "pass_rate",
    "cause accuracy": "cause_accuracy",
    "cause": "cause_accuracy",
    "grounding": "grounding_rate",
    "ground": "grounding_rate",
    "evidence recall": "evidence_recall",
    "recall": "evidence_recall",
    "red herrings": "red_herring_rate",
    "red herring": "red_herring_rate",
    "herrings": "red_herring_rate",
    "herring": "red_herring_rate",
    "citation precision": "citation_precision",
    "precision": "citation_precision",
    "citation validity": "citation_validity",
    "validity": "citation_validity",
    "completion": "completion_rate",
    "cost": "cost_usd",
}

# Phrases that mark a paired difference rather than a variant's own value.
PAIRED_MEAN = ("leads by", "minus", "mean")
PAIRED_SPREAD = ("spread of", "stdev", "spread")


def runs() -> dict[str, list[dict]]:
    by: dict[str, list[dict]] = defaultdict(list)
    for path in sorted(RESULTS.glob("*.json")):
        record = json.loads(path.read_text(encoding="utf-8"))
        by[record["variant"]].append(record["metrics"])
    return by


def paired() -> dict[tuple[str, str], dict]:
    out: dict[tuple[str, str], dict] = {}
    for path in (RESULTS / "paired").glob("*.json"):
        record = json.loads(path.read_text(encoding="utf-8"))
        out[(record["left"], record["right"])] = record["differences"]
    return out


def _matches(text: str, table: dict[str, str]) -> list[tuple[int, str]]:
    """(position, canonical name) for every alias present, longest alias first."""
    found: list[tuple[int, str]] = []
    for alias in sorted(table, key=len, reverse=True):
        for hit in re.finditer(rf"\b{re.escape(alias)}\b", text):
            if not any(h[0] <= hit.start() < h[0] + h[1] for h in ((f[0], len(alias)) for f in found)):
                found.append((hit.start(), table[alias]))
    return sorted(found)


def variants_on(line: str) -> set[str]:
    return {name for _, name in _matches(line.lower(), VARIANTS)}


def metric_before(line: str, at: int) -> str | None:
    """The metric named closest to the left of a figure, within the same line."""
    candidates = [(pos, name) for pos, name in _matches(line.lower(), METRICS) if pos < at]
    return candidates[-1][1] if candidates else None


def allowed(variant: str, metric: str, by: dict[str, list[dict]]) -> set[str]:
    """Every three-decimal figure that is honestly this variant's this metric."""
    values = [r[metric] for r in by.get(variant, []) if isinstance(r.get(metric), (int, float))]
    if not values:
        return set()
    seen = {f"{v:.3f}" for v in values}
    seen.add(f"{statistics.fmean(values):.3f}")
    if len(values) > 1:
        seen.add(f"{statistics.stdev(values):.3f}")
    return seen


def allowed_paired(variant: str, metric: str, pairs: dict[tuple[str, str], dict], line: str) -> set[str]:
    """Paired differences, when the line reads as a comparison rather than a value."""
    lowered = line.lower()
    seen: set[str] = set()
    for (left, right), diffs in pairs.items():
        if variant not in (left, right) or metric not in diffs:
            continue
        stats = diffs[metric]
        if any(w in lowered for w in PAIRED_MEAN):
            seen.add(f"{abs(stats['mean']):.3f}")
        if any(w in lowered for w in PAIRED_SPREAD):
            seen.add(f"{abs(stats['stdev']):.3f}")
        if any(w in lowered for w in PAIRED_MEAN + PAIRED_SPREAD):
            seen.update(f"{abs(d):.3f}" for d in stats["per_seed"])
    return seen


# Words that make a line a comparison, so a figure on it may belong to either
# side. Attribution is skipped there rather than guessed - "0.194 against 0.153"
# names one variant and quotes two variants' values, and forcing a binding on
# that produces false alarms, which is how a gate stops being read.
COMPARISON = ("against", " vs ", "than", "minus", "compared", "\u2192", "->")


def check_line(line: str, by: dict[str, list[dict]], pairs: dict) -> list[str]:
    """Figures on this line quoted as a metric of a variant that never produced them."""
    named = variants_on(line)
    lowered = line.lower()
    if len(named) != 1 or any(w in lowered for w in COMPARISON):
        return []
    variant = next(iter(named))
    problems: list[str] = []
    for hit in re.finditer(r"\b0\.\d{3}\b", line):
        metric = metric_before(line, hit.start())
        if metric is None:
            continue
        ok = allowed(variant, metric, by) | allowed_paired(variant, metric, pairs, line)
        if ok and hit.group() not in ok:
            problems.append(
                f"{hit.group()} is quoted as {metric} for {variant}, "
                "which produced no such value"
            )
    return problems


def check_paired_block(lines: list[str], index: int, pairs: dict) -> list[str]:
    """Validate a `paired on N seeds, X minus Y` block against its artifact.

    This is the rule that catches a block of real numbers under the wrong label:
    a comparison headed "withtriage minus shipped" carried the memory
    comparison's per-seed differences, and every figure in it was a genuine
    paired value - of the other pair.
    """
    header = re.search(r"paired on \d+ seeds?,\s*(\S+)\s+minus\s+(\S+)", lines[index], re.I)
    if not header:
        return []
    left, right = (VARIANTS.get(w.lower(), w.lower()) for w in header.groups())
    diffs = pairs.get((left, right))
    if diffs is None:
        return [f"no committed comparison of {left} against {right}"]
    stats = diffs["pass_rate"]
    honest = {f"{abs(v):.3f}" for v in stats["per_seed"]}
    honest |= {f"{abs(stats[k]):.3f}" for k in ("mean", "stdev")}
    problems: list[str] = []
    for offset in (1, 2):
        if index + offset >= len(lines):
            break
        for hit in re.finditer(r"\b0\.\d{3}\b", lines[index + offset]):
            if hit.group() not in honest:
                problems.append(
                    f"{hit.group()} appears under \"{left} minus {right}\" but is not "
                    "one of that comparison's paired values"
                )
    return problems


def fragments(line: str) -> list[str]:
    """The independently-labelled parts of a line.

    A markdown table row is one line but several claims: the row for the shipped
    workflow describes it, lists its figures, and compares it to the baseline in
    three different cells. Reading the row whole binds its figures to whichever
    variant any cell happens to name.
    """
    return [c for c in line.split("|")] if line.count("|") >= 2 else [line]


def check(path: Path, by: dict[str, list[dict]], pairs: dict) -> list[str]:
    """Every attribution problem in one file, as `path:line: message`."""
    lines = path.read_text(encoding="utf-8").splitlines()
    out: list[str] = []
    for number, line in enumerate(lines, 1):
        for cell in fragments(line):
            for problem in check_line(cell, by, pairs):
                out.append(f"{path}:{number}: {problem}")
        for problem in check_paired_block(lines, number - 1, pairs):
            out.append(f"{path}:{number}: {problem}")
    return out
