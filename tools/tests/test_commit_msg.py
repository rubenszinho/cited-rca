"""Tests for commit message validation."""

from __future__ import annotations

import contextlib
import io
import tempfile
import unittest
from pathlib import Path

from tools.commit.check_commit_msg import (
    CommitRules,
    load_rules,
    main,
    strip_comments,
    validate,
)

RULES = CommitRules(
    types=("feat", "fix", "chore", "docs", "revert"),
    scopes=("infra", "api", "web"),
)


class TestValidate(unittest.TestCase):
    def errors(self, message: str, rules: CommitRules = RULES) -> list[str]:
        return validate(message, rules).errors

    def test_accepts_a_plain_subject(self):
        self.assertEqual(self.errors("feat: add health route"), [])

    def test_accepts_a_scoped_subject(self):
        self.assertEqual(self.errors("fix(api): drop the stale header"), [])

    def test_accepts_a_breaking_marker(self):
        self.assertEqual(self.errors("feat(api)!: rename the response envelope"), [])

    def test_accepts_a_body_after_a_blank_line(self):
        self.assertEqual(self.errors("docs: explain the ratchet\n\nBecause."), [])

    def test_rejects_an_unknown_type(self):
        self.assertIn("'wip'", self.errors("wip: half a thing")[0])

    def test_rejects_an_unknown_scope(self):
        self.assertIn("'db'", self.errors("feat(db): add a table")[0])

    def test_allows_any_scope_when_none_are_configured(self):
        self.assertEqual(self.errors("feat(db): add a table", CommitRules()), [])

    def test_rejects_a_missing_scope_when_required(self):
        rules = CommitRules(scopes=("api",), scope_required=True)
        self.assertIn("scope is required", self.errors("feat: add", rules)[0])

    def test_rejects_a_capitalised_subject(self):
        self.assertIn("lowercase", " ".join(self.errors("feat: Add the thing")))

    def test_rejects_a_trailing_period(self):
        self.assertIn("period", " ".join(self.errors("feat: add the thing.")))

    def test_rejects_an_overlong_subject(self):
        long_subject = "feat: " + "x" * 100
        self.assertIn("max is 72", " ".join(self.errors(long_subject)))

    def test_rejects_a_shapeless_header(self):
        self.assertIn("does not match", self.errors("added some stuff")[0])

    def test_rejects_a_body_glued_to_the_header(self):
        self.assertIn("blank line", " ".join(self.errors("feat: add\nwhy: because")))

    def test_rejects_an_empty_message(self):
        self.assertIn("empty", self.errors("\n# comment only\n")[0])

    def test_ignores_merge_and_fixup_commits(self):
        self.assertEqual(self.errors("Merge branch 'main' into feat/x"), [])
        self.assertEqual(self.errors("fixup! feat: add the thing"), [])

    def test_reports_every_problem_at_once(self):
        self.assertEqual(len(self.errors("feat(db): Add the thing.")), 3)


class TestStripComments(unittest.TestCase):
    def test_drops_comments_and_the_verbose_diff(self):
        message = (
            "feat: add\n"
            "# Please enter the commit message\n"
            "\n"
            "body line\n"
            "diff --git a/x b/x\n"
            "+noise\n"
        )
        self.assertEqual(strip_comments(message), "feat: add\n\nbody line")


class TestRulesAndCli(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.message_file = self.root / "COMMIT_EDITMSG"

    def tearDown(self):
        self.tmp.cleanup()

    def test_defaults_apply_without_a_config(self):
        self.assertEqual(load_rules(self.root).types[0], "feat")
        self.assertEqual(load_rules(self.root).scopes, ())

    def test_config_is_read(self):
        (self.root / "commit.toml").write_text(
            'types = ["feat"]\nscopes = ["api"]\nsubject_max_length = 40\n'
        )
        rules = load_rules(self.root)
        self.assertEqual(rules.types, ("feat",))
        self.assertEqual(rules.subject_max_length, 40)

    def run_cli(self, message: str) -> tuple[int, str]:
        self.message_file.write_text(message)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = main([str(self.message_file)], cwd=self.root)
        return code, out.getvalue()

    def test_cli_passes_a_good_message(self):
        code, text = self.run_cli("feat: add the thing")
        self.assertEqual(code, 0)
        self.assertTrue(text.startswith("PASS"))

    def test_cli_fails_and_echoes_the_header(self):
        code, text = self.run_cli("nope")
        self.assertEqual(code, 1)
        self.assertIn("nope", text)
        self.assertTrue(text.endswith("Exit 1.\n"))


if __name__ == "__main__":
    unittest.main()
