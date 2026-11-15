# Release Evidence Stage

Create a local staging record for a Git commit after checking signed CI evidence for that exact commit and repository. Release Evidence Stage provides two local tools to Claude Code. One demonstrates three evidence scenarios in memory. The other writes a local staging record after a successful check. It neither creates Git tags nor publishes a release on GitHub.

The plugin runs on macOS or Linux with Node.js 22 or newer. Its declared local MCP server uses Node's standard library. It makes no network calls, starts no subprocesses and requires no account. The bundled skill describes how to use these tools. You can try the examples without configuring CI.

## Try the examples

Enable the plugin in Claude Code, then use these prompts:

1. `/release-evidence-stage:review-staging Show me the passing CI evidence example.` The server verifies a freshly signed receipt for the selected commit and reports `would_stage`.
2. `/release-evidence-stage:review-staging Show me the stale commit example.` The signature verifies but the commit differs, so the request is blocked.
3. `/release-evidence-stage:review-staging Show me the missing receipt example.` The server blocks a request that lacks signed evidence.

The examples generate a disposable Ed25519 key in memory. Their results never enter the staging ledger. You can also load the checked-out plugin with `claude --plugin-dir /absolute/path/to/release-evidence-gate/directory-plugin`.

## Stage a commit

Provision a trusted CI signing public key in PEM/SPKI format at `~/.config/release-evidence-stage/OWNER/REPO/ci-public.pem`. Use lowercase repository names. Keep the private key only on a trusted signing service, and protect the public key configuration from replacement. CI should sign only after the release test suite has passed for the stated commit.

Write a UTF-8 `receipt.json` to the same directory with these fields. Replace the example values with data from the actual CI run:

```json
{
  "version": 1,
  "repository": "demo/clock",
  "commit_sha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "suite": "release-tests",
  "conclusion": "success",
  "completed_at": "2026-01-01T12:00:00.000Z"
}
```

Generate a detached Ed25519 signature of the exact bytes of this file, without a prehash. Save the raw 64-byte signature as `receipt.sig` next to the receipt. Supply the actual UTC completion timestamp with 3 fractional digits and a trailing Z. The freshness limit is 24 hours.

Ask Claude to stage that repository and full commit hash. The `stage_commit` tool validates the signature, target, suite, conclusion and completion time inside its MCP server. Only then can it create `~/.local/state/release-evidence-stage/OWNER/REPO/COMMIT.json`. Each read-only JSON manifest contains the repository, commit, suite, CI completion time, SHA-256 of the receipt, and the original signed receipt bytes and signature encoded in base64. A downstream release job can decode the two base64 fields, verify Ed25519 against its own pinned CI public key, and check that the signed target matches the requested release. The tool creates each manifest once using an atomic link and never overwrites it. A retry returns the existing record. A conflicting record or invalid evidence stops the operation. An administrator who controls the host can modify local files.

This is a local pre-release step with a fixed-purpose ledger. Production releases still need their own protected deployment boundary. The operator is responsible for the signer configuration, the local machine's integrity and clock accuracy. The tool does not grant repository permissions or verify that an arbitrary GitHub release has occurred.

## Troubleshooting and privacy

A missing receipt means the public key, receipt or signature is absent. A rejected signature can mean the signed bytes changed or the wrong public key was provisioned. A timestamp rejection can indicate stale CI evidence or clock skew. A commit mismatch requires a receipt for the requested revision. Signature and date errors do not produce staging records.

Input consists of the caller's repository name and commit. The server reads only the public key, receipt, signature and any existing staged record associated with that target under the fixed directories above. It uses no private keys, tokens, telemetry or external storage. Staging records remain on your machine until you remove them. Claude Code may retain tool inputs and short results in its own conversation history. Report an issue through [the project repository](https://github.com/sylvesterkaczmarek/release-evidence-gate/issues).
