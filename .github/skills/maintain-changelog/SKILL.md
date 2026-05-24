---
name: maintain-changelog
description: 'Maintain CHANGELOG.md with a user-first, manual-but-disciplined workflow. Use when updating changelog entries, preparing release notes, structuring an Unreleased section, following Keep a Changelog, defining a lightweight release checklist, or deciding what belongs in release history. Also useful for notas de version, historial de cambios, y mantenimiento de changelog manual.'
argument-hint: '[version=...] [changeSummary=...] [releaseDate=YYYY-MM-DD]'
user-invocable: true
disable-model-invocation: false
---

# Maintain Changelog

## Purpose

Use this skill to keep `CHANGELOG.md` consistent, readable, and useful for users without adding heavy release tooling.

This skill encodes the current decisions for this repository:

* Optimize the changelog for users first, while maintainers rely on git history and PRs for low-level traceability
* Keep `CHANGELOG.md` as the human-curated source of truth for notable changes
* Use a manual `Unreleased` section and light automation only for release cutover or publication support
* Follow Keep a Changelog structure with versioned sections and change categories
* Prefer a lightweight release checklist over semantic-release, Changesets, or commit-derived release generation

## When to Use

Use this skill when you need to:

* Add entries to `CHANGELOG.md`
* Prepare a release from `Unreleased`
* Decide whether a change is notable enough for users
* Keep release notes concise and user-facing
* Enforce categories such as `Added`, `Changed`, `Fixed`, `Security`, `Deprecated`, or `Removed`
* Generate a release checklist without introducing heavy automation

Do not use this skill when you need:

* Full semantic version automation
* Commit-driven release note generation as the primary source of truth
* Internal engineering audit logs with exhaustive implementation detail

## Operating Model

### Source of Truth

`CHANGELOG.md` is the canonical user-facing history.

Git history, pull requests, and issues remain the maintainer-facing detail layer.

### Format Standard

Use Keep a Changelog conventions:

* Keep `## [Unreleased]` at the top
* Promote `Unreleased` content into a versioned section during release
* Group entries by category when needed:
  * `Added`
  * `Changed`
  * `Fixed`
  * `Security`
  * `Deprecated`
  * `Removed`

### Entry Quality Criteria

A good changelog entry is:

* User-visible or operationally relevant
* Written in plain language
* Short enough to scan quickly
* Specific about the outcome, not the implementation minutiae
* Free of PR or issue links by default unless a specific release item needs extra traceability
* Free of commit-message noise such as refactor-only detail unless users would care

## Procedure

### Step 1: Inspect the current state

1. Open `CHANGELOG.md`.
2. Confirm that an `Unreleased` section exists.
3. Check whether categories are already present under `Unreleased`.
4. Identify the current package version in `package.json` if a release is being prepared.

### Step 2: Classify the change

1. Ask whether the change matters to users, operators, or adopters of the extension.
2. If the answer is no, do not add it unless it affects release risk, migration, or security.
3. Map the change to the smallest accurate category:
   * New capability -> `Added`
   * Behavior adjustment -> `Changed`
   * Bug correction -> `Fixed`
   * Vulnerability mitigation or hardening -> `Security`
   * Feature retirement notice -> `Deprecated`
   * Deleted capability -> `Removed`

### Step 3: Write the entry

1. Write one concise bullet per notable change.
2. Describe the outcome from the user's perspective.
3. Avoid raw commit phrasing such as "refactor", "cleanup", or "misc fixes" unless that is the real user impact.
4. Prefer this pattern:
   * action + subject + user-visible effect
5. If helpful, mention constraints or migration impact in one extra clause.

Example patterns:

* Added anchored annotation re-open support from the editor context menu
* Fixed annotation export so malformed YAML escaping no longer breaks downstream parsing
* Security: bounded annotation body length to reduce prompt-injection and context-poisoning risk

### Step 4: Maintain `Unreleased`

1. Add new bullets under `## [Unreleased]`.
2. Create a category heading only when at least one item belongs there.
3. Keep categories ordered consistently.
4. Remove empty category headings.
5. If `Unreleased` becomes noisy, consolidate overlapping bullets instead of listing every internal tweak.

### Step 5: Cut a release

When preparing a release:

1. Choose the new version.
2. Move the curated `Unreleased` entries into a new version section.
3. Use a header like `## [0.0.2] - 2026-05-24`.
4. Reset `## [Unreleased]` to an empty placeholder.
5. Ensure `package.json` version and changelog version agree.
6. Optionally use GitHub-generated release notes as a secondary publication artifact, not as the primary record.

### Step 6: Apply lightweight automation only

Allowed lightweight automation:

* A release checklist
* A validation step that checks `CHANGELOG.md` was updated for a release PR
* Optional GitHub release notes generated from merged work

Avoid as default:

* Semantic release pipelines that author the changelog for you
* Commit-title-based release generation as the canonical changelog
* Heavy configuration that exceeds the repo's release complexity

## Lightweight Release Checklist

Use this checklist when publishing:

1. Confirm `CHANGELOG.md` contains curated user-facing entries under `Unreleased`.
2. Confirm entries are grouped with Keep a Changelog categories when applicable.
3. Confirm the release version in `package.json`.
4. Move `Unreleased` content into the new version section with the release date.
5. Recreate an empty `Unreleased` section.
6. Verify the changelog language is user-facing and free of implementation noise.
7. Optionally publish matching GitHub release notes.

## Decision Rules

If uncertain whether something belongs in the changelog:

* Include it if users would notice it
* Include it if it changes workflow, output, compatibility, or security posture
* Exclude it if it is only internal cleanup with no user-facing consequence
* Merge related implementation details into one higher-level bullet when the outcome is the same

If uncertain whether to add PR or issue references:

* Omit them by default to keep the changelog editorial and user-facing
* Add them only when a release item needs exceptional traceability, such as security fixes or migrations

If uncertain whether to automate:

* Start manual
* Add validation before generation
* Add generation only when release frequency and discipline clearly justify it

## Completion Check

This skill is complete when:

* `CHANGELOG.md` remains readable by users
* `Unreleased` is current and curated
* Release sections are versioned and dated
* Entries are categorized consistently
* Automation, if any, stays lightweight and supports the manual source of truth rather than replacing it

## Example Prompts

* `/maintain-changelog actualiza el Unreleased con los cambios de esta rama`
* `/maintain-changelog prepara la salida de la version 0.0.2`
* `/maintain-changelog decide si estos commits merecen entrar al changelog`
* `/maintain-changelog convierte estas notas tecnicas en entradas orientadas a usuarios`
