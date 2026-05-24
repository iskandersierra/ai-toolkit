---
title: AI Toolkit Context
description: Canonical glossary for the AI Toolkit Visual Studio Code extension domain.
author: GitHub Copilot
ms.date: 2026-05-24
ms.topic: reference
keywords:
  - ai-toolkit
  - vscode extension
  - annotations
estimated_reading_time: 2
---

## Context

This context defines the domain language for AI Toolkit, a Visual Studio Code extension that offers AI-oriented services and tools. The first capability in scope is a code annotation workflow whose generated draft output can be consumed by agents and whose persisted records can be projected into the VS Code comments experience.

Use [docs/threat-model.md](./docs/threat-model.md) as the canonical security-design reference for the annotation-store load and save flows, draft generation, and the repository assurance baseline. It complements this glossary and does not replace the draft-consumption contract.

## Language

**Annotation**:
A user-authored note attached to a concrete range in a workspace file.
_Avoid_: Inline comment, review note, marker

**Annotation Store**:
The persisted project artifact that acts as the source of truth for annotations.
_Avoid_: Comment panel state, ephemeral thread cache

**Local Annotation Store**:
The user-local persistence area where AI Toolkit keeps workspace-specific annotations without treating them as shared repository artifacts.
_Avoid_: Committed team file, ad hoc root artifact

**Workspace Local File**:
A user-local annotation file stored under each workspace folder at `.vscode/ai-toolkit.annotations.json`, and expected to stay out of shared version control.
_Avoid_: Extension-only hidden storage, committed repository artifact

**Session Registry File**:
The single workspace-folder-local file stored at `.vscode/ai-toolkit.annotations.json` that stores all review sessions, their annotations, and the active session marker.
_Avoid_: Per-session sprawl, scattered local files

**Annotation Scope**:
The visibility boundary that determines whether annotations are personal or shared.
_Avoid_: Unstated default, mixed audience

**Annotation Schema**:
The versioned JSON structure, backed by a JSON Schema, that defines how annotations are stored and exchanged.
_Avoid_: Ad hoc payload, implicit format

**Comment Projection**:
The synchronized representation of annotations inside the Visual Studio Code comments UI.
_Avoid_: Source of truth, primary storage

**Annotation Edit Surface**:
The UI entry point where a user can create or modify annotation content, implemented in v1 through a contextual range command for creation and editing, plus a CodeLens shown only on already annotated ranges for fast reopening.
_Avoid_: Implicit panel editing, hidden workflow

**Range Action**:
An editor-local command, exposed in v1 as `AI Toolkit: Add or Edit Annotation`, that operates on the annotated code range.
_Avoid_: Global settings flow, manual file editing

**Annotation Status**:
The lifecycle marker that indicates whether an annotation is active, resolved, or dismissed.
_Avoid_: Hidden flag, implicit workflow state

**Annotation Anchor State**:
The anchor-reliability marker that indicates whether an annotation is still anchored or has become orphaned.
_Avoid_: Lifecycle status, hidden relocation failure

**Review Session**:
A user-defined container for one pass, objective, or line of analysis, which groups annotations under one reusable review context.
_Avoid_: Annotation session, sesión de anotaciones, story, ad hoc batch

**Active Review Session**:
The single review session that receives new annotations and drives the current editor projection.
_Avoid_: Implicit default, mixed session target

**Session Selector**:
The explicit command-driven workflow, exposed in v1 as `AI Toolkit: Select Review Session`, used to inspect sessions and create or switch the active review session when the user manages sessions directly.
_Avoid_: Hidden automatic routing, branch-derived guess

**Session Resolution**:
The prerequisite step that ensures a new annotation flow has an active review session before annotation body capture continues.
_Avoid_: Late routing, body-first capture, implicit orphan write

**Session Maintenance Command**:
An explicit user-invoked command that changes session contents at the session level, either by deleting a review session or by clearing its annotations while preserving the session.
_Avoid_: Per-annotation cleanup, hidden destructive action, mixed semantics

**Default Review Session Name**:
The auto-assigned human-readable name used when AI Toolkit creates a review session without requiring manual naming, starting with `Review Session` and incrementing for additional default sessions.
_Avoid_: Opaque id, timestamp-only label, mandatory first-use naming

**Quick Capture Flow**:
The short command-driven input sequence used to create a new annotation from a code selection, resolving an active review session before asking for the annotation body.
_Avoid_: Heavy form, manual store editing

**Comment Thread Projection**:
The one-thread representation of an annotation inside the VS Code comments panel.
_Avoid_: Multi-card panel item, full metadata dump

**Annotation Summary Metadata**:
The minimal metadata shown with an annotation in the comments UI for quick interpretation, specifically session, status, and anchor state.
_Avoid_: Full record dump, hidden status context

**Annotation Body**:
The main free-text content of an annotation.
_Avoid_: Separate title-body split, empty placeholder

**Annotation Classification**:
Any additional labeling or type system beyond session and status.
_Avoid_: Premature taxonomy, free-form tags in v1

**Orphaned Annotation**:
An annotation whose anchor can no longer be relocated with sufficient confidence after code changes, while remaining preserved in the store with `anchorState = orphaned` and still visible through comment projection until the user explicitly reanchors or dismisses it.
_Avoid_: Silent deletion, guessed relocation

**Draft Output Command**:
The explicit user-invoked command, exposed in v1 as `AI Toolkit: Generate Draft Output`, that turns the active review session into a new unsaved output document.
_Avoid_: Agent-only trigger, automatic background export

**Untitled Output Document**:
A new unsaved editor document created by the extension, named in v1 with the pattern `ai-toolkit-{sessionSlug}.{ext}`, so the user can inspect, edit, or reuse generated content before deciding whether to save it.
_Avoid_: Forced saved file, agent-only artifact

**Draft Output Format**:
The configured document format the extension uses when it creates an untitled output document for a review session, preserving the same session-and-annotation semantics across formats while projecting them narratively in Markdown and structurally in JSON or YAML.
_Avoid_: Hardcoded export type, per-run mandatory prompt

**Draft Trust Metadata**:
The field-level metadata attached to generated draft output that tells consumers whether a value is system-derived or user-authored, and how Markdown rendering treats it.
_Avoid_: Implicit trust, guesswork, format-specific assumptions

**Store Content Hash**:
The provenance value carried in generated draft output that identifies the persisted annotation-store snapshot used to produce the draft.
_Avoid_: Trust signal, annotation checksum, mutable session id

**Annotation Anchor**:
The locator data that keeps an annotation attached to the intended code even after edits.
_Avoid_: Raw range, fixed position

**Agent Workflow**:
Any automated process that reads annotations to produce review output, plans, or other derived artifacts.
_Avoid_: Extension command, UI interaction

**Anchor Fingerprint**:
The combination of selected lines and nearby context used to relocate an annotation when the original range drifts.
_Avoid_: Full diff, semantic model

## Relationships

* An **Annotation** belongs to exactly one file range
* The **Annotation Store** contains one or more **Annotations**
* The **Annotation Store** conforms to one **Annotation Schema** version
* The **Annotation Store** lives in a **Local Annotation Store** in the first version
* The **Local Annotation Store** is implemented as a **Workspace Local File** in the first version
* The **Workspace Local File** is a single **Session Registry File** in the first version
* The **Annotation Store** has one **Annotation Scope**
* Each **Annotation** has exactly one **Annotation Anchor**
* Each **Annotation** has exactly one **Annotation Status**
* Each **Annotation** has exactly one **Annotation Anchor State**
* Each **Annotation** has exactly one **Annotation Body** in the first version
* The first version has no **Annotation Classification** beyond session and status
* An **Orphaned Annotation** stays in the **Annotation Store** until the user reanchors or dismisses it
* An **Annotation** may belong to one **Review Session**
* Exactly one **Active Review Session** exists per user at a time
* A new **Quick Capture Flow** resolves one **Active Review Session** before it captures an **Annotation Body**
* A **Draft Output Command** operates on the **Active Review Session**
* A **Draft Output Command** uses one configured **Draft Output Format**
* A **Draft Output Command** creates one **Untitled Output Document**
* The **Session Selector** creates or changes the **Active Review Session** explicitly
* A **Session Maintenance Command** may clear all **Annotations** from a **Review Session** without deleting the session
* A **Session Maintenance Command** may delete a **Review Session** together with its **Annotations**
* A **Default Review Session Name** may be assigned automatically when a new **Review Session** is created without manual naming
* New annotations are created through the **Quick Capture Flow**
* Each **Annotation** is shown as one **Comment Thread Projection** in the comments UI
* Each **Comment Thread Projection** exposes minimal **Annotation Summary Metadata**
* A **Comment Projection** mirrors one **Annotation** in the Visual Studio Code comments UI
* The **Comment Projection** is read-only in the first version
* The **Annotation Edit Surface** owns content changes in the first version
* The **Annotation Edit Surface** uses a **Range Action** to edit an existing **Annotation** near its code
* An **Annotation Anchor** uses an **Anchor Fingerprint** to recover from file edits
* An **Agent Workflow** reads generated draft output, not the raw **Annotation Store** or the **Comment Projection**
* Generated draft output exposes **Draft Trust Metadata** for every downstream consumer
* Generated draft output carries one **Store Content Hash** so consumers can track provenance to the persisted store snapshot

## Example dialogue

> **Dev:** "If I update an annotation in the comments panel, what is the real record?"
> **Domain expert:** "The **Annotation Store** is the real record; the panel only shows the **Comment Projection** generated from it."
>
> **Dev:** "What happens if the code moves after I annotate it?"
> **Domain expert:** "The **Annotation Anchor** tries the saved range first, then uses the **Anchor Fingerprint** to relocate the annotation."
>
> **Dev:** "What format do agents read when they process annotations?"
> **Domain expert:** "They read generated draft output, which is the supported automation contract. The raw **Annotation Store** remains the persistence layer, not the recommended agent interface."
> **Dev:** "How should an agent treat the values inside a generated draft?"
> **Domain expert:** "Read the **Draft Trust Metadata** first. User-authored fields and annotation bodies stay untrusted content even when the surrounding draft structure is system-derived."
> **Dev:** "What does the store hash in the draft mean?"
> **Domain expert:** "The **Store Content Hash** identifies which persisted annotation-store snapshot produced the draft, so consumers can track provenance without reinterpreting the raw store directly."
>
> **Dev:** "Can I edit an annotation from the comments panel?"
> **Domain expert:** "Not in the first version; the panel is a read-only **Comment Projection**, and edits happen through the dedicated **Annotation Edit Surface**."
>
> **Dev:** "How do I change an existing annotation if I am reading code?"
> **Domain expert:** "Use the **Range Action** `AI Toolkit: Add or Edit Annotation` on the annotated range to open the edit flow."
>
> **Dev:** "Do I need to rely on CodeLens to create annotations?"
> **Domain expert:** "No. In the first version, the base **Annotation Edit Surface** is the contextual range command, while CodeLens appears only on already annotated ranges to reopen the same flow faster."
>
> **Dev:** "How do I tell whether an annotation still matters?"
> **Domain expert:** "Each **Annotation** carries an **Annotation Status** so agents and users can distinguish active notes from resolved or dismissed ones."
>
> **Dev:** "Is orphaned another status value?"
> **Domain expert:** "No. **Orphaned Annotation** describes the **Annotation Anchor State**, not the **Annotation Status**, so an annotation can be resolved and still be orphaned until someone explicitly reanchors or dismisses it."
>
> **Dev:** "Where does the annotation file go?"
> **Domain expert:** "In the first version it belongs to a user-local **Local Annotation Store**, implemented as the **Workspace Local File** `.vscode/ai-toolkit.annotations.json` instead of extension-only storage."
>
> **Dev:** "Do sessions live in separate local files?"
> **Domain expert:** "No, the first version keeps them together in one **Session Registry File**, including the active session marker."
>
> **Dev:** "Does an annotation have a title and a body?"
> **Domain expert:** "Not in the first version; an annotation only stores one **Annotation Body** to keep capture fast and the panel lightweight."
>
> **Dev:** "Can I tag an annotation as bug, idea, or question?"
> **Domain expert:** "Not in the first version; **Annotation Classification** stops at session and status so capture stays fast and the taxonomy stays consistent."
>
> **Dev:** "What if the code changes so much that the annotation cannot be found again?"
> **Domain expert:** "It becomes an **Orphaned Annotation**, stays preserved with `anchorState = orphaned` in the **Session Registry File**, remains visible in the comments experience, and waits for an explicit reanchor or dismissal instead of being moved silently."
>
> **Dev:** "How do I turn my notes into something I can use elsewhere?"
> **Domain expert:** "Use the **Draft Output Command** `AI Toolkit: Generate Draft Output` on the **Active Review Session**, which creates an **Untitled Output Document** that stays unsaved until you decide otherwise."
>
> **Dev:** "How does the extension choose the untitled document format?"
> **Domain expert:** "The first version reads the configured **Draft Output Format** from the extension settings, instead of prompting every time, while keeping the same core session and annotation data across Markdown, JSON, and YAML."
>
> **Dev:** "Are annotations shared with the rest of the team?"
> **Domain expert:** "Not in the first version; the default **Annotation Scope** is local to one user to avoid merge conflicts while the workflow settles."
>
> **Dev:** "Can I keep separate passes for different objectives?"
> **Domain expert:** "Yes, each user can keep multiple **Review Sessions**, but only one **Active Review Session** receives new annotations at a time."
>
> **Dev:** "How do I choose which session receives the next annotation?"
> **Domain expert:** "Use the **Session Selector** `AI Toolkit: Select Review Session` to create or switch the **Active Review Session** explicitly, and persist that choice locally."
>
> **Dev:** "What happens the moment I select code and create an annotation?"
> **Domain expert:** "The extension opens a **Quick Capture Flow** from `AI Toolkit: Add or Edit Annotation`, keeping creation lightweight with a short input sequence instead of a full form."
>
> **Dev:** "What if I create an annotation before I have any session at all?"
> **Domain expert:** "The flow first performs **Session Resolution** so the annotation has an **Active Review Session** before body capture continues, creating the first session with a **Default Review Session Name** when no session exists yet."
>
> **Dev:** "What is the difference between clearing and deleting a session?"
> **Domain expert:** "A **Session Maintenance Command** can either clear annotations from a **Review Session** while keeping that session reusable, or delete the entire **Review Session** together with its annotations."
>
> **Dev:** "How should the annotation appear in the comments panel?"
> **Domain expert:** "Use one **Comment Thread Projection** per annotation, keeping the main note visible and the UI lightweight."
>
> **Dev:** "What metadata should I see in that thread?"
> **Domain expert:** "Show only the minimal **Annotation Summary Metadata** needed to interpret the note quickly, specifically session, status, and anchor state."

## Flagged ambiguities

* "comment" was used to mean both a persisted **Annotation** and its VS Code **Comment Projection**; resolved: the file-backed annotation is canonical, the panel view is derived
* "selection" was used as if it were enough to persist location; resolved: a saved range alone is not canonical, the **Annotation Anchor** includes both range and textual fingerprint
* "format" was left open between JSON, YAML, and Markdown; resolved: the canonical agent-consumption surface is generated draft output, while the persisted **Annotation Store** remains versioned JSON
* "edit from the panel" was left undecided; resolved: the first version keeps the comments panel read-only and routes edits through a separate **Annotation Edit Surface**
* "editing UI" was fuzzy; resolved: existing annotations are edited from a range-local editor action rather than by opening the raw store
* "comment lifecycle" was implicit; resolved: annotations have an explicit **Annotation Status** with the minimal lifecycle set `active`, `resolved`, and `dismissed` instead of plain free text only
* "where to persist" changed after the collaboration decision; resolved: the first version keeps annotations in a user-local **Local Annotation Store** instead of a repository-scoped artifact
* "local persistence medium" was unresolved; resolved: the first version uses the readable **Workspace Local File** `.vscode/ai-toolkit.annotations.json` under the workspace rather than extension-only storage
* "one file or many" was unresolved; resolved: the first version uses a single **Session Registry File** that contains all review sessions
* "shared by default" was reconsidered; resolved: the first version uses a local **Annotation Scope** to avoid branch merge conflicts
* "stories de anotaciones" was ambiguous; resolved: the canonical term is **Review Session**, meaning a user-defined set of annotations for one review pass
* "multiple local sets" was unresolved; resolved: users can maintain multiple **Review Sessions** with one **Active Review Session** at a time
* "title versus body" was unresolved; resolved: the first version stores a single **Annotation Body** with no separate title field
* "tags or types" was unresolved; resolved: the first version has no extra **Annotation Classification** beyond session and status
* "failed reanchoring" was unresolved; resolved: the first version preserves the note as an **Orphaned Annotation** through a separate **Annotation Anchor State** until the user reanchors or dismisses it
* "how orphaned annotations surface in v1" was unresolved; resolved: orphaned annotations stay visible both in the local store and in the comments experience, and users resolve them only through explicit reanchor or dismiss actions
* "agent-specific output" was reconsidered; resolved: users invoke a **Draft Output Command** on the **Active Review Session**, and the result opens as an **Untitled Output Document** rather than an agent-specific artifact
* "how output format is chosen" was unresolved; resolved: the first version uses a configured **Draft Output Format** in extension settings instead of forcing a choice on each command execution
* "output content by format" was unresolved; resolved: all configured output formats carry the same session and annotation semantics, with Markdown rendered for human reading and JSON or YAML rendered as equivalent structured data
* "untitled output naming" was unresolved; resolved: the first version names each **Untitled Output Document** with the pattern `ai-toolkit-{sessionSlug}.{ext}`
* "ontitle" was used for the unsaved file concept; resolved: the canonical term is **Untitled Output Document**
* "which session is current" was unresolved; resolved: users choose the active session through an explicit **Session Selector** command rather than automatic inference
* "what happens before the first session exists" was unresolved; resolved: new annotation capture performs **Session Resolution**, auto-creating the first **Review Session** with a **Default Review Session Name** when no session exists and otherwise requiring an explicit session choice before body capture
* "delete session versus clear session" was unresolved; resolved: a **Session Maintenance Command** either deletes a **Review Session** and its annotations or clears annotations while keeping the session reusable
* "v1 command set" was unresolved; resolved: the first version exposes capture, session selection, draft generation, annotation lifecycle actions, and explicit session maintenance commands rather than only the original three commands
* "capture UI" was unresolved; resolved: new annotations use a lightweight **Quick Capture Flow** instead of a full creation form
* "panel representation" was unresolved; resolved: each annotation appears as a lightweight single **Comment Thread Projection** rather than a richer card structure
* "visible panel metadata" was unresolved; resolved: the **Annotation Summary Metadata** shown in the panel is limited to session, status, and anchor state
* "minimal editor edit surface" was unresolved; resolved: the first version uses both a contextual command and CodeLens, but CodeLens appears only for existing annotations while creation always works through the contextual range action
