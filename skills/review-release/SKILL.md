---
name: review-release
description: Inspect the current, stale and missing CI receipt examples for release-evidence-gate, or explain how to connect a commit-addressed release tool.
disable-model-invocation: true
---

For a walkthrough, run `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/demo.py"` after the user permits the command. The script uses a temporary home directory and a disposable signing key. Explain the requested example using its actual output. Acceptance means the hook allowed a tool call to continue through the normal permission checks.

For installation questions, read the bundled README. The hook matches only the MCP tool named `mcp__release__publish_commit`. It reads the immutable target and signed CI evidence before that tool runs. A real release requires the operator to supply a compatible release server and CI signer.
