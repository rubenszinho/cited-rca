"""Paired per-seed comparison of two variants.

A prose claim like "memory leads by 0.042 with a spread of 0.087" is derived
from the committed runs, but it is not any run's value nor any variant's mean,
so `verify_claims.py` cannot back it from `results/*.json` alone.

The obvious repair - teach the claims gate to accept any paired difference
between any two variants - was measured and rejected. It grows the set of
accepted three-decimal figures from 359 to 772 out of 1000, at which point the
gate passes almost any number and stops being evidence of anything.

So the comparison is computed once, committed as an artifact under
`results/paired/`, and the gate reads it. Only pairs a document actually claims
are backed, the file is regenerable from the same runs, and the accepted set
grows by a few dozen values rather than four hundred.

    python3 harness/paired.py agent-withtriage agent
"""

from __future__ import annotations

import json
import statistics
import sys
from pathlib import Path

RESULTS = Path(__file__).resolve().parent.parent / "results"
OUT = RESULTS / "paired"


def seeds_of(variant: str) -> list[Path]:
    """Every run of a variant, ordered by seed so the pairing is positional."""
    return sorted(RESULTS.glob(f"{variant}-seed*.json"), key=lambda p: int(p.stem.split("seed")[-1]))


def metrics_of(paths: list[Path]) -> list[dict]:
    return [json.loads(p.read_text(encoding="utf-8"))["metrics"] for p in paths]


def numeric_keys(runs: list[dict]) -> list[str]:
    first = runs[0]
    return sorted(
        k
        for k, v in first.items()
        if isinstance(v, (int, float)) and not isinstance(v, bool)
    )


def differences(left: list[dict], right: list[dict]) -> dict[str, dict]:
    """metric -> per-seed differences plus their mean and sample stdev."""
    out: dict[str, dict] = {}
    for key in numeric_keys(left):
        if any(key not in run for run in right):
            continue
        deltas = [round(a[key] - b[key], 6) for a, b in zip(left, right)]
        out[key] = {
            "per_seed": deltas,
            "mean": round(statistics.fmean(deltas), 6),
            "stdev": round(statistics.stdev(deltas), 6) if len(deltas) > 1 else 0.0,
            "wins": sum(1 for d in deltas if d > 1e-9),
            "losses": sum(1 for d in deltas if d < -1e-9),
        }
    return out


def build(left: str, right: str, left_paths: list[Path], right_paths: list[Path]) -> dict:
    """The comparison record, ready to commit."""
    return {
        "left": left,
        "right": right,
        "seeds": len(left_paths),
        "commit": json.loads(left_paths[0].read_text(encoding="utf-8"))["commit"],
        "differences": differences(metrics_of(left_paths), metrics_of(right_paths)),
    }


def write(record: dict) -> Path:
    """Commit the record and echo the primary metric, which is what gets quoted."""
    OUT.mkdir(parents=True, exist_ok=True)
    dest = OUT / f"{record['left']}-vs-{record['right']}.json"
    dest.write_text(json.dumps(record, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    d = record["differences"]["pass_rate"]
    print(
        f"{record['left']} - {record['right']}: mean {d['mean']:+.3f} "
        f"stdev {d['stdev']:.3f} wins {d['wins']} losses {d['losses']} "
        f"-> {dest.relative_to(RESULTS.parent)}"
    )
    return dest


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: paired.py <variant-a> <variant-b>", file=sys.stderr)
        return 2
    left, right = argv
    left_paths, right_paths = seeds_of(left), seeds_of(right)
    if not left_paths or len(left_paths) != len(right_paths):
        print(
            f"error: {left} has {len(left_paths)} runs and {right} has "
            f"{len(right_paths)}; a paired comparison needs the same seeds on both sides",
            file=sys.stderr,
        )
        return 2
    write(build(left, right, left_paths, right_paths))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
