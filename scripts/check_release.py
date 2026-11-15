"""Claude Code PreToolUse hook for a release tool that takes an immutable SHA."""

import datetime as dt
import json
import re
import subprocess
import sys
from pathlib import Path

TOOL = "mcp__release__publish_commit"
NAMESPACE = "release-evidence-gate-v1"
IDENTITY = "release-ci"
SUITE = "release-tests"
MAX_AGE = dt.timedelta(hours=24)
REPOSITORY = re.compile(r"[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9][A-Za-z0-9._-]*")


class EvidenceError(ValueError):
    pass


def check(event, config_dir, now):
    if not isinstance(event, dict) or not isinstance(event.get("tool_name"), str):
        raise EvidenceError("Missing tool identity.")
    if event["tool_name"] != TOOL:
        return
    args = event.get("tool_input")
    if not isinstance(args, dict):
        raise EvidenceError("Missing release arguments.")
    repo, commit = args.get("repository"), args.get("commit_sha")
    if not isinstance(repo, str) or not REPOSITORY.fullmatch(repo) or repo.split("/")[1] in {".", ".."}:
        raise EvidenceError("Expected repository in owner/repo form.")
    if not isinstance(commit, str) or not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise EvidenceError("The release must name an exact 40-character Git commit.")

    directory = config_dir / repo
    receipt = directory / "receipt.json"
    signature = directory / "receipt.json.sig"
    signers = directory / "allowed_signers"
    if not all(path.is_file() for path in (receipt, signature, signers)):
        raise EvidenceError("Missing signed CI receipt or trusted signer for " + repo + ".")
    with receipt.open("rb") as stream:
        raw = stream.read(16385)
    if len(raw) > 16384:
        raise EvidenceError("The CI receipt is too large.")
    verified = subprocess.run(
        ["ssh-keygen", "-Y", "verify", "-f", str(signers), "-I", IDENTITY,
         "-n", NAMESPACE, "-s", str(signature)],
        input=raw, capture_output=True, timeout=5, check=False,
    )
    if verified.returncode:
        raise EvidenceError("The CI receipt signature did not verify.")
    evidence = json.loads(raw)
    if not isinstance(evidence, dict):
        raise EvidenceError("Expected a signed JSON object.")
    if evidence.get("repository") != repo or evidence.get("commit_sha") != commit:
        raise EvidenceError("CI evidence belongs to another repository or commit.")
    if evidence.get("suite") != SUITE or evidence.get("conclusion") != "success":
        raise EvidenceError("A passing release-tests result is required.")
    stamp = evidence.get("completed_at")
    if not isinstance(stamp, str):
        raise EvidenceError("Missing CI completion timestamp.")
    completed = dt.datetime.strptime(stamp, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)
    age = now - completed
    if not dt.timedelta(0) <= age <= MAX_AGE:
        raise EvidenceError("CI evidence is expired or future-dated.")


def main():
    try:
        event = json.load(sys.stdin)
        check(event, Path.home() / ".config" / "release-evidence-gate", dt.datetime.now(dt.timezone.utc))
    except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
        print("Release evidence check blocked the tool call. " + str(exc), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
