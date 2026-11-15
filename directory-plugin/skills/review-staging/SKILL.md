---
name: review-staging
description: Compare three signed CI receipt examples or explicitly stage a commit locally after checking the evidence.
disable-model-invocation: true
---

For a walkthrough, call the staging server's `inspect_example` tool with `passing`, `stale_commit` or `missing`, as requested. Report the verdict and reason. Demo receipts and records stay in memory. For the user's own repository, call `stage_commit` only when they ask to stage and provide an owner/repository plus a full commit hash. Give the tool's actual verdict, and on success clarify that the result is a local staging record. The server handles verification and staging in the same tool call.
