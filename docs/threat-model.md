---
title: AI Toolkit Threat Model
description: Lightweight STRIDE threat model and risk register for annotation storage, draft generation, and repository security controls.
author: GitHub Copilot
ms.date: 2026-05-24
ms.topic: reference
keywords:
  - threat model
  - stride
  - risk register
  - security
estimated_reading_time: 4
---

## Scope

This document captures the current security design baseline for AI Toolkit. It focuses on the operational flows that matter for the repository today:

* Loading the local annotation store from `.vscode/ai-toolkit.annotations.json`
* Saving updates back to that local annotation store
* Generating draft output for downstream agent and automation consumption

The repository treats generated draft output as the supported automation contract. The raw annotation store remains a local persistence artifact and contains untrusted user-authored content.

## System boundaries

The extension runs inside the local Visual Studio Code process and reads or writes only workspace-local annotation data. The core trust boundaries are:

* User-authored annotation content crossing into persisted storage
* Persisted annotation content crossing into generated draft output
* Repository automation crossing from source changes into CI, dependency updates, and static analysis

## STRIDE summary

| Flow | Spoofing | Tampering | Repudiation | Information disclosure | Denial of service | Elevation of privilege | Existing controls | Remaining gap |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Annotation-store load | A local actor can edit the workspace file and impersonate trusted state | The store file can be modified outside the extension | The store does not provide authenticated authorship | Sensitive notes in the local file can be exposed if the workspace is shared | Invalid or oversized content can block annotation workflows | A crafted store could try to influence downstream automation | Schema validation, runtime validation, bounded annotation body size, local-only storage path | No signed provenance for persisted store authorship; workspace sharing remains an operator concern |
| Annotation-store save | A caller can attempt to save on top of an unexpected snapshot | Concurrent or external writes can change persisted content between reads and writes | The local workflow has limited audit evidence for who changed annotations | Saved annotations may contain sensitive review notes | Corrupt save paths can make the local workflow unavailable | A malformed save result could have been misinterpreted before the invalid-save fix | Content hashing, typed invalid-save handling, workspace-local persistence | No separate audit log; recovery still depends on local backups and operator discipline |
| Draft generation | A consumer could mistake untrusted fields for trusted system instructions | User-authored content could be copied into a downstream workflow without trust checks | Consumers may not record which store snapshot a draft came from | Draft output can expose annotation content to broader tooling | Large or malformed drafts can slow downstream consumers | Downstream agents could over-trust the generated structure | Draft `trustMetadata`, fenced untrusted Markdown content, `storeContentHash`, documented draft-consumption contract | Consumers must still enforce trust metadata and apply their own execution safeguards |

## Risk register

| Risk ID | Threat | Affected flow | Current controls | Residual risk | Follow-up owner |
| --- | --- | --- | --- | --- | --- |
| TM-01 | Local annotation-store edits can spoof trusted state for later consumers | Annotation-store load | Schema validation, runtime validation, documented draft-consumption contract | Medium: the workspace file is still user-controlled and unsigned | Repository maintainer |
| TM-02 | External or concurrent store writes can tamper with saves or create ambiguous outcomes | Annotation-store save | Content hash generation, typed invalid-save result, local backup behavior | Medium: no independent audit trail exists for local mutation history | Repository maintainer |
| TM-03 | Downstream automation can over-trust generated draft fields or annotation bodies | Draft generation | `trustMetadata`, fenced untrusted Markdown, `storeContentHash`, README and CONTEXT guidance | Medium: external consumers can still ignore the contract | Extension and automation consumers |
| TM-04 | Repository assurance gaps can let dependency or code changes land without enough review signals | Repository automation | CI compile, lint, full test contract, audit, Dependabot, CodeQL | Medium: branch protection and private reporting availability cannot be verified from the repo contents alone | Repository owner |

## Assurance posture

The repository currently relies on a layered but lightweight assurance baseline:

* `pnpm run lint` checks the TypeScript source tree for repository-local regressions
* `pnpm run test` executes the documented unit and VS Code extension-host test contract
* `pnpm audit --audit-level=high` provides dependency vulnerability screening in CI
* Dependabot proposes npm and GitHub Actions updates on a weekly cadence
* CodeQL runs JavaScript and TypeScript static analysis on pushes, pull requests, and a weekly schedule

## Known external verification gaps

Some controls depend on repository settings or hosted platform configuration that cannot be proven from tracked files alone:

* GitHub private vulnerability reporting must stay enabled for the advisory submission URL in `.github/SECURITY.md` to remain operational
* Branch protection, required status checks, and review enforcement are not represented in the repository contents

Treat those items as operational follow-up work rather than inferred facts.
