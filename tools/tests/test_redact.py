"""Tests for trajectory redaction.

The submitted agent trajectories are verbatim session transcripts. If the
redactor silently stops matching a credential shape, the leak is published.
These tests pin every rule the redactor claims to enforce.

Every credential below is synthetic.
"""

from __future__ import annotations

import unittest
from collections import Counter

from tools.trajectory.redact import redact_text, walk


class TestCredentialRules(unittest.TestCase):
    def fire(self, payload: str) -> tuple[str, Counter]:
        counts: Counter = Counter()
        return redact_text(payload, counts), counts

    def assert_redacted(self, payload: str, rule: str, secret: str | None = None):
        out, counts = self.fire(payload)
        self.assertIn(rule, counts, f"{rule} did not fire on {payload!r}")
        self.assertNotIn(secret or payload, out, f"{rule} matched but left the value")

    def test_anthropic_key(self):
        self.assert_redacted("sk-ant-api03-" + "A" * 40, "anthropic_key")

    def test_openai_key(self):
        self.assert_redacted("sk-proj-" + "B" * 40, "openai_key")

    def test_github_pat(self):
        self.assert_redacted("ghp_" + "c" * 36, "github_pat")

    def test_aws_access_key_id(self):
        self.assert_redacted("AKIAIOSFODNN7EXAMPLE", "aws_key_id")

    def test_google_api_key(self):
        self.assert_redacted("AIza" + "D" * 35, "google_key")

    def test_slack_token(self):
        self.assert_redacted("xoxb-123456789012-abcdefghijkl", "slack_token")

    def test_jwt(self):
        self.assert_redacted(
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N",
            "jwt",
        )

    def test_private_key_block(self):
        self.assert_redacted(
            "-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----",
            "private_key",
        )

    def test_bearer_header_keeps_the_header_name(self):
        out, counts = self.fire("Authorization: Bearer abc123def456")
        self.assertIn("bearer_header", counts)
        self.assertNotIn("abc123def456", out)
        self.assertIn("Authorization", out)


class TestEnvAssignments(unittest.TestCase):
    """A cat'd .env is the most likely way a real secret enters a transcript."""

    def redacted(self, line: str) -> str:
        counts: Counter = Counter()
        return redact_text(line, counts)

    def test_redacts_a_secret_looking_name(self):
        out = self.redacted("BEARER_SIGNING_SECRET=hunter2hunter2")
        self.assertNotIn("hunter2hunter2", out)
        self.assertIn("BEARER_SIGNING_SECRET", out)

    def test_redacts_api_key_names(self):
        self.assertNotIn("abcdefghijklmnop",
                         self.redacted("OPENAI_API_KEY=sk-x-abcdefghijklmnop"))

    def test_leaves_a_harmless_setting_alone(self):
        line = "LOG_LEVEL=debug"
        self.assertEqual(self.redacted(line), line)


class TestEmailHandling(unittest.TestCase):
    def redacted(self, text: str) -> str:
        counts: Counter = Counter()
        return redact_text(text, counts)

    def test_redacts_a_personal_address(self):
        self.assertNotIn("someone@example.com", self.redacted("someone@example.com"))

    def test_keeps_the_published_organiser_address(self):
        # Public contact info from the challenge page; redacting it would make
        # the trajectories harder to read for no privacy gain.
        self.assertEqual(self.redacted("yeison@micro1.ai"), "yeison@micro1.ai")


class TestWalk(unittest.TestCase):
    def test_descends_into_nested_structures(self):
        counts: Counter = Counter()
        out = walk({"a": [{"b": "ghp_" + "z" * 36}]}, counts)
        self.assertIn("github_pat", counts)
        self.assertNotIn("ghp_", str(out))

    def test_leaves_non_strings_untouched(self):
        counts: Counter = Counter()
        self.assertEqual(walk({"n": 1, "ok": True, "none": None}, counts),
                         {"n": 1, "ok": True, "none": None})


if __name__ == "__main__":
    unittest.main()
