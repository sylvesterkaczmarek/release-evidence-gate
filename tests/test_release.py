import datetime as dt
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

PLUGIN = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PLUGIN / "scripts"))

from check_release import EvidenceError, check

NOW = dt.datetime(2026, 1, 1, 12, tzinfo=dt.timezone.utc)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.directory = self.root / "example" / "repo"
        self.directory.mkdir(parents=True)
        self.key = self.root / "key"
        subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(self.key)], check=True)
        (self.directory / "allowed_signers").write_text("release-ci " + self.key.with_suffix(".pub").read_text())
        self.event = {"tool_name": "mcp__release__publish_commit",
                      "tool_input": {"repository": "example/repo", "commit_sha": "a" * 40}}
        self.receipt = {**self.event["tool_input"], "suite": "release-tests",
                        "conclusion": "success", "completed_at": "2026-01-01T12:00:00Z"}

    def sign(self):
        path = self.directory / "receipt.json"
        signature = self.directory / "receipt.json.sig"
        signature.unlink(missing_ok=True)
        path.write_text(json.dumps(self.receipt))
        subprocess.run(["ssh-keygen", "-Y", "sign", "-q", "-f", str(self.key),
                        "-n", "release-evidence-gate-v1", str(path)], check=True)

    def test_matching_commit(self):
        self.sign()
        self.assertIsNone(check(self.event, self.root, NOW))

    def test_older_and_future_records(self):
        self.sign()
        for when in (NOW + dt.timedelta(days=1, seconds=1), NOW - dt.timedelta(seconds=1)):
            with self.subTest(when=when), self.assertRaisesRegex(EvidenceError, "expired"):
                check(self.event, self.root, when)
        self.assertIsNone(check(self.event, self.root, NOW + dt.timedelta(days=1)))

    def test_wrong_evidence(self):
        for key, value in [("repository", "other/repo"), ("commit_sha", "b" * 40),
                           ("suite", "lint"), ("conclusion", "failure")]:
            with self.subTest(key=key):
                original = self.receipt[key]
                self.receipt[key] = value
                self.sign()
                with self.assertRaises(EvidenceError):
                    check(self.event, self.root, NOW)
                self.receipt[key] = original

    def test_tampered_receipt(self):
        self.sign()
        with (self.directory / "receipt.json").open("a") as writer:
            writer.write(" ")
        with self.assertRaisesRegex(EvidenceError, "signature"):
            check(self.event, self.root, NOW)

    def test_missing_evidence(self):
        with self.assertRaisesRegex(EvidenceError, "Missing signed CI receipt"):
            check(self.event, self.root, NOW)

    def test_irrelevant_tool(self):
        self.assertIsNone(check({"tool_name": "Read"}, self.root, NOW))

    def test_invalid_target(self):
        for key, value in [("repository", "example/.."), ("repository", "/etc/passwd"),
                           ("commit_sha", "main"), ("commit_sha", "--help")]:
            with self.subTest(key=key, value=value):
                args = {**self.event["tool_input"], key: value}
                with self.assertRaises(EvidenceError):
                    check({**self.event, "tool_input": args}, self.root, NOW)

    def test_invalid_event_blocks_in_hook(self):
        proc = subprocess.run([sys.executable, str(PLUGIN / "scripts" / "check_release.py")],
                              input="{}", text=True, capture_output=True,
                              env={**os.environ, "HOME": str(self.root)})
        self.assertEqual(proc.returncode, 2)
        self.assertIn("Missing tool identity", proc.stderr)


if __name__ == "__main__":
    unittest.main()
