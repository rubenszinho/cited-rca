"""The clean-clone replay contract.

A judge clones the repo, runs the documented command, and replays every model
call from the committed cassettes. That only works if the model the clone
resolves is the model the cassettes were recorded on - the model is part of
every cassette key.

It was not. `env.template` shipped `anthropic/claude-sonnet-4.5` long after the
evaluation moved to gpt-4.1-mini, because the real model lived in the gitignored
`.env.overrides`. Every replay in a clean clone missed every cassette, produced
twelve provider errors per run, and wrote a results table of zeros - while
`run.py` still printed "6/6 runs ok", because the solution catches provider
errors per case and the process exits 0.

These two tests pin both halves so neither can come back quietly.
"""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
RESULTS = ROOT / "results"


def template_model() -> str:
    text = (ROOT / "env.template").read_text(encoding="utf-8")
    match = re.search(r"^LLM_MODEL=(.+)$", text, re.MULTILINE)
    assert match, "env.template must set LLM_MODEL"
    return match.group(1).strip()


def recorded_models() -> set[str]:
    return {
        json.loads(p.read_text(encoding="utf-8"))["metrics"]["model"]
        for p in RESULTS.glob("*.json")
    }


class TestReplayContract(unittest.TestCase):
    def test_template_model_matches_the_recorded_runs(self) -> None:
        """A clone must resolve the model its cassettes were recorded on."""
        recorded = recorded_models()
        self.assertTrue(recorded, "no committed results to check the template against")
        self.assertEqual(
            recorded,
            {template_model()},
            f"env.template ships LLM_MODEL={template_model()!r} but the committed "
            f"runs were recorded on {sorted(recorded)!r}. A clean clone would miss "
            "every cassette. Re-record, or correct the template.",
        )

    def test_no_committed_run_carries_a_provider_error(self) -> None:
        """Provider errors are contamination, not a result. None may be committed."""
        dirty = {
            p.name: json.loads(p.read_text(encoding="utf-8"))["metrics"]["provider_errors"]
            for p in RESULTS.glob("*.json")
            if json.loads(p.read_text(encoding="utf-8"))["metrics"].get("provider_errors")
        }
        self.assertFalse(dirty, f"runs recorded with provider errors: {dirty}")
