"""Tests for the terminal-width comparison view.

The full results table is nineteen columns wide because every column backs a
claim somewhere. That is right for a document and useless on a screen, so
`--brief` prints the six a person actually compares variants on. These pin that
it reports the same numbers as the full table rather than a second opinion.
"""

from __future__ import annotations

import unittest

from harness.compare import BRIEF_METRICS, render_brief

AGGS = {
    "baseline": {m: (0.5, 0.1, 6) for _, m in BRIEF_METRICS},
    "agent": {m: (0.75, 0.2, 6) for _, m in BRIEF_METRICS},
}


class TestRenderBrief(unittest.TestCase):
    def test_one_row_per_variant_plus_header_and_rule(self) -> None:
        rows = render_brief(["baseline", "agent"], AGGS)
        self.assertEqual(len(rows), 4)
        self.assertTrue(rows[0].startswith("variant"))

    def test_reports_the_mean_to_three_decimals(self) -> None:
        rows = render_brief(["agent"], AGGS)
        self.assertIn("0.750", rows[-1])

    def test_keeps_the_order_it_is_given(self) -> None:
        rows = render_brief(["agent", "baseline"], AGGS)
        self.assertTrue(rows[2].startswith("agent"))
        self.assertTrue(rows[3].startswith("baseline"))

    def test_a_missing_metric_does_not_crash_the_row(self) -> None:
        """A variant recorded before a metric existed still renders."""
        rows = render_brief(["agent"], {"agent": {}})
        self.assertIn("nan", rows[-1])
