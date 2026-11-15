# Release Evidence Gate

When Claude Code calls a commit-addressed release tool, this plugin checks that CI signed a passing result for the requested repository and Git commit within the last 24 hours. It checks the receipt just before the tool runs. A receipt for yesterday's commit cannot authorise today's commit, even if both commits belong to the same branch.

The hook matches one MCP tool, `mcp__release__publish_commit`, with string arguments `repository` (owner/repo) and `commit_sha` (40 lowercase hexadecimal characters). Configure a matching release server to use this check for your releases. The tool must publish that immutable commit. Other tools and shell commands remain outside this hook. Enforce your production release policy in CI and on the release server too.

## Try it in Claude Code

This plugin requires Python 3.9 or newer and OpenSSH 8.2 or newer with `ssh-keygen`. Start a Claude Code session using `claude --plugin-dir /absolute/path/to/release-evidence-gate`. Invoke the skill with any of these prompts:

1. `/release-evidence-gate:review-release Show me which CI evidence allows the current demo commit.`
2. `/release-evidence-gate:review-release Show me what happens after changing the release commit without rerunning tests.`
3. `/release-evidence-gate:review-release Check what the hook reports when the CI receipt is missing.`

To run the same walkthrough directly, use `python3 scripts/demo.py`. It generates a temporary signing key, signs one example receipt, runs the actual hook against three simulated inputs and removes the temporary directory. It never publishes a release. The current commit passes, another commit is blocked and a missing receipt is blocked.

## Connect a CI signer

Install a trusted OpenSSH allowed-signers file at `~/.config/release-evidence-gate/OWNER/REPO/allowed_signers`. Its single line begins with the principal `release-ci`, followed by a space and the CI signing public key in OpenSSH format. Provision this file separately from the receipts. Keep the signing private key on your trusted CI signing service.

Have that service verify that the required release tests passed for the exact immutable target. Create a UTF-8 file named `receipt.json` containing the fields below, populated from the trusted CI run.

```json
{
  "repository": "demo/clock",
  "commit_sha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "suite": "release-tests",
  "conclusion": "success",
  "completed_at": "2026-01-01T12:00:00Z"
}
```

Use the actual UTC completion time in second precision. On the signing service, sign the exact bytes with `ssh-keygen -Y sign -f /path/to/ci_signing_key -n release-evidence-gate-v1 receipt.json`. Deliver the receipt and signature file (`receipt.json.sig`) into that repository's evidence directory. Interleaved file updates fail closed until a matching pair is present. The plugin never fetches CI data itself.

The release target must be immutable. Protect the signer configuration and hook from user or agent modification, restrict alternative release paths, and ensure the release server checks permissions. Cached evidence permits reuse for the same commit during its validity period. Disabling the hook, compromising the signing key or misconfiguring the CI workflow invalidates these assumptions.

## Troubleshooting

A missing receipt means the repository-specific signer, receipt or signature is absent. A signature error means the signer or signed bytes do not match. A stale timestamp or future timestamp can also indicate clock skew. A mismatch after a new commit requires a fresh CI run on that commit. Run `python3 -m unittest discover -s tests` from the plugin directory to check the local installation.

## Privacy and support

The plugin reads the local event, public key and CI receipt. It makes no network requests, writes no usage logs and collects no credentials. The demo writes disposable sample data to a temporary directory. Claude Code can include the short blocking reason in its normal session history. For questions, [open an issue](https://github.com/sylvesterkaczmarek/release-evidence-gate/issues). Include the blocking reason and use fabricated examples for repository details.
