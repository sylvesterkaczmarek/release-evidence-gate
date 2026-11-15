"""Exercise the installed hook with a disposable signing key and three sample events."""

import datetime as dt
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HOOK = Path(__file__).resolve().with_name("check_release.py")
REPO = "demo/clock"
CURRENT = "a" * 40


def run_hook(home, commit):
    event = {"tool_name": "mcp__release__publish_commit",
             "tool_input": {"repository": REPO, "commit_sha": commit}}
    return subprocess.run(
        [sys.executable, str(HOOK)], input=json.dumps(event), text=True,
        capture_output=True, env={**os.environ, "HOME": str(home)}, check=False,
    )


def main():
    with tempfile.TemporaryDirectory() as workspace:
        home = Path(workspace)
        evidence = home / ".config" / "release-evidence-gate" / REPO
        evidence.mkdir(parents=True)
        key = home / "disposable-key"
        subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(key)], check=True)
        (evidence / "allowed_signers").write_text("release-ci " + key.with_suffix(".pub").read_text())
        missing = run_hook(home, CURRENT)
        stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        record = {"repository": REPO, "commit_sha": CURRENT, "suite": "release-tests",
                  "conclusion": "success", "completed_at": stamp}
        receipt = evidence / "receipt.json"
        receipt.write_text(json.dumps(record) + "\n")
        subprocess.run(["ssh-keygen", "-Y", "sign", "-q", "-f", str(key),
                        "-n", "release-evidence-gate-v1", str(receipt)], check=True)
        examples = [("current commit", run_hook(home, CURRENT), 0),
                    ("previous commit tested", run_hook(home, "b" * 40), 2),
                    ("missing receipt", missing, 2)]
        for label, result, expected in examples:
            print(f"{label}: {result.stderr.strip() or 'evidence accepted'}")
            if result.returncode != expected:
                return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
