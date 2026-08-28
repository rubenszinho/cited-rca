"""Tests for session naming and port allocation."""

from __future__ import annotations

import contextlib
import io
import subprocess
import tempfile
import unittest
from pathlib import Path

from tools.env.render_env import (
    PortAllocator,
    main,
    render,
    session_name,
    slugify,
    stale_session_warning,
)

TEMPLATE = 'SESSION={{ session }}\nA={{ port "app" }}\nURL=http://x:{{ port "app" }}\nB={{ port "db" }}\n'


def git(root: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=root, check=True, capture_output=True)


class TestPortAllocator(unittest.TestCase):
    def test_same_key_is_stable_within_a_run(self):
        allocator = PortAllocator("demo", probe_bound=False)
        self.assertEqual(allocator.allocate("app"), allocator.allocate("app"))

    def test_same_session_is_stable_across_runs(self):
        first = PortAllocator("demo", probe_bound=False).allocate("app")
        second = PortAllocator("demo", probe_bound=False).allocate("app")
        self.assertEqual(first, second)

    def test_different_sessions_differ(self):
        left = PortAllocator("demo-main", probe_bound=False).allocate("app")
        right = PortAllocator("demo-feat", probe_bound=False).allocate("app")
        self.assertNotEqual(left, right)

    def test_keys_do_not_collide_within_a_session(self):
        allocator = PortAllocator("demo", probe_bound=False)
        ports = {allocator.allocate(k) for k in ("a", "b", "c", "d", "e")}
        self.assertEqual(len(ports), 5)

    def test_ports_are_in_the_configured_window(self):
        allocator = PortAllocator("demo", probe_bound=False)
        for key in ("a", "b", "c"):
            self.assertTrue(20000 <= allocator.allocate(key) < 60000)

    def test_a_bound_port_is_rerolled(self):
        allocator = PortAllocator("demo", probe_bound=False)
        first = allocator.allocate("app")

        class OnlyFirstIsBound(PortAllocator):
            def _is_free(self, port: int) -> bool:
                return port != first

        self.assertNotEqual(OnlyFirstIsBound("demo").allocate("app"), first)


class TestRender(unittest.TestCase):
    def test_substitutes_both_directives(self):
        allocator = PortAllocator("demo", probe_bound=False)
        text = render(TEMPLATE, "demo", allocator)
        self.assertIn("SESSION=demo", text)
        self.assertNotIn("{{", text)

    def test_repeated_key_renders_the_same_port(self):
        allocator = PortAllocator("demo", probe_bound=False)
        lines = dict(
            line.split("=", 1) for line in render(TEMPLATE, "demo", allocator).splitlines()
        )
        self.assertTrue(lines["URL"].endswith(lines["A"]))
        self.assertNotEqual(lines["A"], lines["B"])

    def test_slugify_flattens_branch_separators(self):
        self.assertEqual(slugify("feat/Enrich_CSV"), "feat-enrich-csv")


class TestStaleWarning(unittest.TestCase):
    def test_silent_when_unchanged(self):
        self.assertEqual(stale_session_warning("a", "a"), "")
        self.assertEqual(stale_session_warning(None, "a"), "")

    def test_names_both_sessions_when_changed(self):
        warning = stale_session_warning("old-main", "old-feat")
        self.assertIn("old-main", warning)
        self.assertIn("old-feat", warning)
        self.assertIn("dev:stop-clean", warning)


class TestSessionAndCli(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "myrepo"
        self.root.mkdir()
        git(self.root, "init", "-q", "-b", "main")
        (self.root / "env.template").write_text(TEMPLATE)

    def tearDown(self):
        self.tmp.cleanup()

    def run_cli(self, *argv: str) -> tuple[int, str]:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = main(list(argv), cwd=self.root)
        return code, out.getvalue()

    def test_session_is_repo_and_branch(self):
        self.assertEqual(session_name(self.root), "myrepo-main")

    def test_branch_changes_the_session(self):
        git(self.root, "checkout", "-q", "-b", "feat/login")
        self.assertEqual(session_name(self.root), "myrepo-feat-login")

    def test_renders_the_env_file(self):
        code, text = self.run_cli()
        self.assertEqual(code, 0)
        self.assertIn("SESSION=myrepo-main", (self.root / ".env").read_text())
        self.assertIn("myrepo-main", text)

    def test_missing_template_fails(self):
        (self.root / "env.template").unlink()
        code, text = self.run_cli()
        self.assertEqual(code, 1)
        self.assertIn("env.template", text)

    def test_branch_rename_blocks_until_forced(self):
        self.run_cli()
        git(self.root, "checkout", "-q", "-b", "feat/login")
        code, text = self.run_cli()
        self.assertEqual(code, 1)
        self.assertIn("WARNING", text)
        self.assertIn("SESSION=myrepo-main", (self.root / ".env").read_text())
        code, _text = self.run_cli("--force")
        self.assertEqual(code, 0)
        self.assertIn("SESSION=myrepo-feat-login", (self.root / ".env").read_text())


if __name__ == "__main__":
    unittest.main()
