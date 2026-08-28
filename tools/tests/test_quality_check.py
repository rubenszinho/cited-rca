"""Tests for the quality ratchet.

Every rule of the ratchet is pinned here, because the gate is the one piece
of infrastructure that must not quietly change behaviour: a subtle break
means violations start passing silently.
"""

from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from tools.quality import quality_check
from tools.quality.baseline import filter_to_violators, load_baseline, save_baseline
from tools.quality.collect import (
    FileEntry,
    FunctionEntry,
    Snapshot,
    iter_scope_files,
    parse_adapter_ndjson,
    parse_lizard_csv,
    worst,
)
from tools.quality.config import Scope, load_config
from tools.quality.diff import compute_diff, has_failures
from tools.quality.report import render

THRESHOLDS = {"nloc": 25, "ccn": 15, "params": 5, "file_lines": 500}

CONFIG_TOML = """
[thresholds]
nloc = 25
ccn = 15
params = 5
file_lines = 500

[[scope]]
name = "app"
path = "src"
extensions = [".py"]
excludes = ["/__tests__/"]
language = "python"
"""


def fn(nloc: int = 1, ccn: int = 1, params: int = 0) -> FunctionEntry:
    return FunctionEntry(nloc=nloc, ccn=ccn, params=params)


def file_entry(lines: int = 10, **functions: FunctionEntry) -> FileEntry:
    return FileEntry(file_lines=lines, functions=dict(functions))


def snapshot(**files: FileEntry) -> Snapshot:
    return Snapshot(version=1, thresholds=dict(THRESHOLDS), files=dict(files))


class TestConfig(unittest.TestCase):
    def _load(self, body: str):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "quality.toml"
            path.write_text(body)
            return load_config(Path(tmp))

    def test_parses_thresholds_and_scope(self):
        config = self._load(CONFIG_TOML)
        self.assertEqual(config.thresholds, THRESHOLDS)
        self.assertEqual(config.scopes[0].name, "app")
        self.assertEqual(config.scopes[0].extensions, (".py",))
        self.assertEqual(config.scopes[0].languages, ("python",))
        self.assertEqual(config.scopes[0].engine, "lizard")

    def test_languages_list_form(self):
        body = CONFIG_TOML.replace(
            'language = "python"', 'languages = ["typescript", "tsx"]',
        )
        self.assertEqual(self._load(body).scopes[0].languages, ("typescript", "tsx"))

    def test_adapter_overrides_engine(self):
        body = CONFIG_TOML + '\nadapter = "tools/quality/adapters/generic.sh"\n'
        scope = self._load(body).scopes[0]
        self.assertEqual(scope.engine, "adapter")
        self.assertEqual(scope.adapter, "tools/quality/adapters/generic.sh")

    def test_missing_config_is_an_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(FileNotFoundError):
                load_config(Path(tmp))

    def test_unknown_scope_key_is_rejected(self):
        with self.assertRaises(ValueError) as ctx:
            self._load(CONFIG_TOML + '\nlanguag = "python"\n')
        self.assertIn("languag", str(ctx.exception))

    def test_unknown_threshold_is_rejected(self):
        with self.assertRaises(ValueError) as ctx:
            self._load(CONFIG_TOML.replace("nloc = 25", "nloc = 25\nnested = 2"))
        self.assertIn("nested", str(ctx.exception))

    def test_non_positive_threshold_is_rejected(self):
        with self.assertRaises(ValueError) as ctx:
            self._load(CONFIG_TOML.replace("ccn = 15", "ccn = 0"))
        self.assertIn("ccn", str(ctx.exception))

    def test_missing_scope_is_rejected(self):
        body = CONFIG_TOML.split("[[scope]]")[0]
        with self.assertRaises(ValueError) as ctx:
            self._load(body)
        self.assertIn("[[scope]]", str(ctx.exception))

    def test_unknown_engine_is_rejected(self):
        with self.assertRaises(ValueError) as ctx:
            self._load(CONFIG_TOML + '\nengine = "radon"\n')
        self.assertIn("radon", str(ctx.exception))


class TestParsers(unittest.TestCase):
    def test_parses_a_lizard_row(self):
        row = "12,3,80,2,20,\"parse@1-20@a.py\",/repo/src/a.py,parse,parse(x),1,20"
        records = parse_lizard_csv(row)
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["function"], "parse")
        self.assertEqual((records[0]["nloc"], records[0]["ccn"]), (12, 3))
        self.assertEqual(records[0]["params"], 2)

    def test_skips_short_and_malformed_rows(self):
        rows = "\n".join([
            "1,2,3",
            "x,3,80,2,20,loc,/repo/src/a.py,parse,long,1,20",
            "",
            "12,3,80,2,20,loc,/repo/src/a.py,ok,long,1,20",
        ])
        self.assertEqual([r["function"] for r in parse_lizard_csv(rows)], ["ok"])

    def test_parses_adapter_ndjson(self):
        out = '{"file": "src/a.go", "function": "Run", "ccn": 9}\n\n'
        records = parse_adapter_ndjson(out, "x.sh")
        self.assertEqual(records[0]["ccn"], 9)

    def test_absent_adapter_metric_records_as_zero(self):
        records = parse_adapter_ndjson('{"file": "a", "function": "b"}', "x.sh")
        self.assertEqual(records[0]["nloc"], 0)
        self.assertEqual(records[0]["params"], 0)

    def test_invalid_adapter_json_names_the_adapter(self):
        with self.assertRaises(ValueError) as ctx:
            parse_adapter_ndjson("not json", "tools/x.sh")
        self.assertIn("tools/x.sh", str(ctx.exception))

    def test_adapter_record_without_file_is_rejected(self):
        with self.assertRaises(ValueError):
            parse_adapter_ndjson('{"function": "b"}', "x.sh")

    def test_worst_of_collapses_per_metric(self):
        self.assertEqual(
            worst(fn(nloc=30, ccn=2, params=1), fn(nloc=5, ccn=20, params=0)),
            fn(nloc=30, ccn=20, params=1),
        )


class TestScopeWalk(unittest.TestCase):
    def test_filters_by_extension_and_excludes_and_sorts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "src" / "__tests__").mkdir(parents=True)
            for name in ("b.py", "a.py", "c.txt"):
                (root / "src" / name).write_text("x\n")
            (root / "src" / "__tests__" / "d.py").write_text("x\n")
            scope = Scope(
                name="app", path="src", extensions=(".py",), excludes=("/__tests__/",),
            )
            names = [p.name for p in iter_scope_files(root, scope)]
        self.assertEqual(names, ["a.py", "b.py"])

    def test_missing_scope_directory_yields_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            scope = Scope(name="app", path="nope", extensions=(".py",))
            self.assertEqual(iter_scope_files(Path(tmp), scope), [])


class TestBaselineIO(unittest.TestCase):
    def test_round_trip_and_formatting(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "b.json"
            save_baseline(path, snapshot(**{"a.py": file_entry(600)}))
            text = path.read_text()
            self.assertTrue(text.endswith("\n"))
            self.assertIn('\n  "files"', text)
            self.assertEqual(load_baseline(path)["files"]["a.py"]["file_lines"], 600)

    def test_missing_baseline_is_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(load_baseline(Path(tmp) / "absent.json"))

    def test_filter_keeps_only_violators(self):
        snap = snapshot(**{
            "big.py": file_entry(600, ok=fn()),
            "fine.py": file_entry(10, ok=fn()),
            "hot.py": file_entry(10, hot=fn(ccn=99), ok=fn()),
        })
        files = filter_to_violators(snap, THRESHOLDS)["files"]
        self.assertEqual(sorted(files), ["big.py", "hot.py"])
        self.assertEqual(list(files["hot.py"]["functions"]), ["hot"])
        self.assertEqual(files["big.py"]["functions"], {})

    def test_recorded_function_keeps_all_metrics(self):
        snap = snapshot(**{"a.py": file_entry(10, f=fn(nloc=99, ccn=2, params=1))})
        entry = filter_to_violators(snap, THRESHOLDS)["files"]["a.py"]["functions"]["f"]
        self.assertEqual(entry, fn(nloc=99, ccn=2, params=1))


class TestRatchetRules(unittest.TestCase):
    def test_clean_snapshot_without_baseline_passes(self):
        diff = compute_diff(snapshot(**{"a.py": file_entry(10, f=fn())}), None, THRESHOLDS)
        self.assertFalse(has_failures(diff))
        self.assertEqual(diff["improvements"], [])

    def test_new_violation_without_baseline(self):
        snap = snapshot(**{"a.py": file_entry(10, f=fn(nloc=40))})
        diff = compute_diff(snap, None, THRESHOLDS)
        self.assertEqual(diff["new_violations"][0]["metrics"], {"nloc": (40, 25)})

    def test_grandfathered_function_is_gated_on_its_baseline(self):
        base = snapshot(**{"a.py": file_entry(10, f=fn(nloc=40))})
        same = compute_diff(base, base, THRESHOLDS)
        self.assertFalse(has_failures(same))

    def test_regression_against_baseline(self):
        base = snapshot(**{"a.py": file_entry(10, f=fn(nloc=40))})
        worse = snapshot(**{"a.py": file_entry(10, f=fn(nloc=41))})
        diff = compute_diff(worse, base, THRESHOLDS)
        self.assertEqual(diff["regressions"][0]["metrics"], {"nloc": (41, 40)})

    def test_improvement_against_baseline(self):
        base = snapshot(**{"a.py": file_entry(10, f=fn(nloc=40))})
        better = snapshot(**{"a.py": file_entry(10, f=fn(nloc=30))})
        diff = compute_diff(better, base, THRESHOLDS)
        self.assertEqual(diff["improvements"][0]["metrics"], {"nloc": (30, 40)})
        self.assertFalse(has_failures(diff))

    def test_new_function_in_a_baselined_file_must_meet_strict_thresholds(self):
        base = snapshot(**{"a.py": file_entry(600, old=fn(nloc=40))})
        current = snapshot(**{
            "a.py": file_entry(600, old=fn(nloc=40), added=fn(nloc=30)),
        })
        diff = compute_diff(current, base, THRESHOLDS)
        self.assertEqual(diff["new_violations"][0]["function"], "added")
        self.assertEqual(diff["new_violations"][0]["metrics"], {"nloc": (30, 25)})

    def test_a_compliant_file_is_not_frozen_at_its_recorded_length(self):
        """Baselined for a function, not for length: growth is not a regression."""
        base = snapshot(**{"a.py": file_entry(16, f=fn(nloc=40))})
        grown = snapshot(**{"a.py": file_entry(21, f=fn(nloc=40))})
        diff = compute_diff(grown, base, THRESHOLDS)
        self.assertFalse(has_failures(diff))
        self.assertEqual(diff["improvements"], [])

    def test_a_compliant_baselined_file_crossing_the_limit_is_a_new_violation(self):
        base = snapshot(**{"a.py": file_entry(16, f=fn(nloc=40))})
        grown = snapshot(**{"a.py": file_entry(501, f=fn(nloc=40))})
        diff = compute_diff(grown, base, THRESHOLDS)
        self.assertEqual(diff["new_violations"][0]["metrics"], {"file_lines": (501, 500)})

    def test_file_growth_beyond_baseline_is_a_regression(self):
        base = snapshot(**{"a.py": file_entry(600)})
        diff = compute_diff(snapshot(**{"a.py": file_entry(601)}), base, THRESHOLDS)
        self.assertEqual(diff["regressions"][0]["metrics"], {"file_lines": (601, 600)})

    def test_new_file_over_the_limit_is_a_new_violation(self):
        diff = compute_diff(snapshot(**{"a.py": file_entry(501)}), None, THRESHOLDS)
        self.assertEqual(diff["new_violations"][0]["metrics"], {"file_lines": (501, 500)})

    def test_removed_function_is_an_improvement(self):
        base = snapshot(**{"a.py": file_entry(10, gone=fn(nloc=40))})
        diff = compute_diff(snapshot(**{"a.py": file_entry(10)}), base, THRESHOLDS)
        self.assertTrue(diff["improvements"][0]["removed"])
        self.assertEqual(diff["improvements"][0]["function"], "gone")

    def test_deleted_file_yields_one_improvement_per_record(self):
        base = snapshot(**{"a.py": file_entry(600, f=fn(nloc=40))})
        diff = compute_diff(snapshot(), base, THRESHOLDS)
        self.assertEqual(len(diff["improvements"]), 2)
        self.assertTrue(all(i["removed"] for i in diff["improvements"]))


class TestReport(unittest.TestCase):
    def _render(self, diff, mode="ci", written=False):
        return render(diff, mode, written, THRESHOLDS)

    def test_quiet_pass(self):
        text, code = self._render(compute_diff(snapshot(), None, THRESHOLDS))
        self.assertEqual(code, 0)
        self.assertTrue(text.startswith("PASS"))
        self.assertNotIn("ADVICE", text)

    def test_new_violation_fails_with_advice_for_that_metric_only(self):
        snap = snapshot(**{"a.py": file_entry(10, f=fn(nloc=40))})
        text, code = self._render(compute_diff(snap, None, THRESHOLDS))
        self.assertEqual(code, 1)
        self.assertIn("NEW VIOLATIONS", text)
        self.assertIn("nloc - Long functions", text)
        self.assertNotIn("params - Long param lists", text)
        self.assertTrue(text.endswith("Exit 1.\n"))

    def test_regression_shows_the_strict_max_for_context(self):
        base = snapshot(**{"a.py": file_entry(10, f=fn(nloc=40))})
        worse = snapshot(**{"a.py": file_entry(10, f=fn(nloc=41))})
        text, code = self._render(compute_diff(worse, base, THRESHOLDS))
        self.assertEqual(code, 1)
        self.assertIn("baseline 40", text)
        self.assertIn("strict max: 25", text)

    def test_mixed_report_lists_both_sections(self):
        base = snapshot(**{"a.py": file_entry(10, old=fn(nloc=40))})
        current = snapshot(**{
            "a.py": file_entry(10, old=fn(nloc=41), added=fn(ccn=30)),
        })
        text, code = self._render(compute_diff(current, base, THRESHOLDS))
        self.assertEqual(code, 1)
        self.assertIn("REGRESSIONS", text)
        self.assertIn("NEW VIOLATIONS", text)

    def test_improvement_in_ci_is_drift(self):
        base = snapshot(**{"a.py": file_entry(10, f=fn(nloc=40))})
        better = snapshot(**{"a.py": file_entry(10, f=fn(nloc=30))})
        text, code = self._render(compute_diff(better, base, THRESHOLDS))
        self.assertEqual(code, 1)
        self.assertIn("baseline is stale", text)

    def test_improvement_absorbed_locally_passes(self):
        base = snapshot(**{"a.py": file_entry(10, f=fn(nloc=40))})
        better = snapshot(**{"a.py": file_entry(10, f=fn(nloc=30))})
        text, code = self._render(
            compute_diff(better, base, THRESHOLDS), mode="local", written=True,
        )
        self.assertEqual(code, 0)
        self.assertIn("absorbed", text)
        self.assertIn("commit it", text)

    def test_improvement_locally_without_write_is_quiet(self):
        base = snapshot(**{"a.py": file_entry(10, f=fn(nloc=40))})
        better = snapshot(**{"a.py": file_entry(10, f=fn(nloc=30))})
        _text, code = self._render(
            compute_diff(better, base, THRESHOLDS), mode="local", written=False,
        )
        self.assertEqual(code, 0)


class TestCli(unittest.TestCase):
    """End-to-end exit codes, with measurement stubbed out."""

    def setUp(self):
        self._real = quality_check.collect_snapshot
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "quality.toml").write_text(CONFIG_TOML)
        self.baseline = self.root / ".quality-baseline.json"

    def tearDown(self):
        quality_check.collect_snapshot = self._real
        self.tmp.cleanup()

    def stub(self, snap: Snapshot) -> None:
        quality_check.collect_snapshot = lambda _root, _config: snap

    def write_baseline(self, snap: Snapshot) -> None:
        save_baseline(self.baseline, filter_to_violators(snap, THRESHOLDS))

    def run_cli(self, *argv: str) -> int:
        """Run the CLI with stdout captured, so test output stays readable."""
        self.output = io.StringIO()
        with contextlib.redirect_stdout(self.output):
            return quality_check.main(list(argv), cwd=self.root)

    def test_missing_baseline_means_strict_mode(self):
        self.stub(snapshot(**{"a.py": file_entry(10, f=fn(nloc=40))}))
        self.assertEqual(self.run_cli("check"), 1)
        self.assertFalse(self.baseline.exists())

    def test_generate_baseline_then_check_passes(self):
        self.stub(snapshot(**{"a.py": file_entry(10, f=fn(nloc=40))}))
        self.assertEqual(self.run_cli("generate-baseline"), 0)
        self.assertEqual(self.run_cli("check"), 0)

    def test_generate_baseline_refuses_to_overwrite_without_force(self):
        self.stub(snapshot(**{"a.py": file_entry(10, f=fn(nloc=40))}))
        self.assertEqual(self.run_cli("generate-baseline"), 0)
        self.assertEqual(self.run_cli("generate-baseline"), 1)
        self.assertEqual(self.run_cli("generate-baseline", "--force"), 0)

    def test_ci_fails_on_stale_baseline_and_leaves_it_untouched(self):
        self.write_baseline(snapshot(**{"a.py": file_entry(10, f=fn(nloc=40))}))
        before = self.baseline.read_text()
        self.stub(snapshot(**{"a.py": file_entry(10, f=fn(nloc=30))}))
        self.assertEqual(self.run_cli("check"), 1)
        self.assertEqual(self.baseline.read_text(), before)

    def test_write_absorbs_the_improvement(self):
        self.write_baseline(snapshot(**{"a.py": file_entry(10, f=fn(nloc=40))}))
        self.stub(snapshot(**{"a.py": file_entry(10, f=fn(nloc=30))}))
        self.assertEqual(self.run_cli("check", "--write"), 0)
        recorded = json.loads(self.baseline.read_text())
        self.assertEqual(recorded["files"]["a.py"]["functions"]["f"]["nloc"], 30)

    def test_write_does_not_absorb_when_something_regressed(self):
        self.write_baseline(snapshot(**{"a.py": file_entry(10, f=fn(nloc=40))}))
        before = self.baseline.read_text()
        self.stub(snapshot(**{"a.py": file_entry(10, f=fn(nloc=41))}))
        self.assertEqual(self.run_cli("check", "--write"), 1)
        self.assertEqual(self.baseline.read_text(), before)

    def test_print_thresholds_emits_every_metric(self):
        self.assertEqual(self.run_cli("print-thresholds"), 0)
        self.assertEqual(
            sorted(self.output.getvalue().split()),
            ["ccn=15", "file_lines=500", "nloc=25", "params=5"],
        )


if __name__ == "__main__":
    unittest.main()
