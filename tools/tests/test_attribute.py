"""Tests for figure attribution.

The claims gate used to ask only whether a number existed somewhere in
results/. Three defects passed it: a paired block of real numbers printed under
the wrong comparison's label, a docstring arguing every rejection with a
superseded grid's figures, and two documents stating different numbers for the
same comparison. Every one is a real value attached to the wrong claim.

These tests pin both halves of the fix - that a misattributed figure is caught,
and that ordinary comparative prose is not falsely accused, which is the failure
mode that gets a gate ignored.
"""

from __future__ import annotations

import unittest

from tools.repro import attribute

BY = {
    "agent": [{"pass_rate": 0.1667, "cause_accuracy": 0.9091, "grounding_rate": 0.4167}],
    "agent-withtriage": [{"pass_rate": 0.25, "cause_accuracy": 0.9091, "grounding_rate": 0.6364}],
}
PAIRS = {
    ("agent-withtriage", "agent"): {
        "pass_rate": {"per_seed": [0.083, -0.167], "mean": 0.028, "stdev": 0.126}
    }
}


class TestAttribution(unittest.TestCase):
    def test_flags_a_figure_no_run_of_that_variant_produced(self) -> None:
        problems = attribute.check_line("triage pass rate 0.667", BY, PAIRS)
        self.assertTrue(problems)
        self.assertIn("pass_rate", problems[0])

    def test_accepts_a_variant_own_value(self) -> None:
        self.assertEqual(attribute.check_line("triage pass rate 0.250", BY, PAIRS), [])

    def test_ignores_comparative_prose(self) -> None:
        """"0.250 against 0.167" names one variant and quotes two. Not a claim
        this check can bind, and guessing produces false alarms."""
        line = "triage leads on pass rate, 0.250 against 0.167"
        self.assertEqual(attribute.check_line(line, BY, PAIRS), [])

    def test_ignores_an_arrow_comparison(self) -> None:
        self.assertEqual(
            attribute.check_line("grounding 0.417 -> 0.636 for triage", BY, PAIRS), []
        )


class TestPairedBlocks(unittest.TestCase):
    def block(self, numbers: str) -> list[str]:
        lines = ["paired on 6 seeds, withtriage minus shipped", numbers, ""]
        return attribute.check_paired_block(lines, 0, PAIRS)

    def test_flags_another_comparison_numbers_under_this_label(self) -> None:
        # The exact defect: real paired values, wrong pair.
        self.assertTrue(self.block("  +0.042, +0.087"))

    def test_accepts_the_comparisons_own_values(self) -> None:
        self.assertEqual(self.block("  +0.083, -0.167"), [])

    def test_reports_a_comparison_with_no_committed_artifact(self) -> None:
        lines = ["paired on 6 seeds, memory minus shipped", "  +0.042", ""]
        self.assertTrue(attribute.check_paired_block(lines, 0, PAIRS))
