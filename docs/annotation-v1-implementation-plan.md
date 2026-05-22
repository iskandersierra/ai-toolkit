---
title: AI Toolkit Annotation V1 Implementation Plan
description: Technical implementation plan for Annotation V1, including selection validation, session resolution, session maintenance commands, comment projection, and draft generation.
author: GitHub Copilot
ms.date: 2026-05-22
ms.topic: how-to
keywords:
  - ai-toolkit
  - annotations
  - implementation plan
  - review sessions
estimated_reading_time: 10
---

## Goal

Implement the first end-to-end annotation workflow for AI Toolkit as a Visual Studio Code extension. The first version must let a user capture annotations on code ranges, organize them into review sessions, maintain those sessions explicitly, project them into the comments panel, generate draft outputs, and keep the workspace-local store as the single source of truth.

## Scope

* Store annotations per workspace folder in `.vscode/ai-toolkit.annotations.json`
* Keep the persisted store as canonical and the comments UI as a derived projection
* Support multiple review sessions with one active session per workspace folder
* Auto-create the first review session when capture starts without any existing session
* Expose the first command surface, keybinding family, and comment projection behavior
* Expose explicit delete-session and clear-session-annotations maintenance commands
* Generate draft outputs in Markdown, JSON, or YAML from the active session
* Validate the store with a bundled JSON Schema and runtime validation
* Handle reanchoring, dismissal, resolve and reopen, purge of dismissed annotations, backups, and optimistic writes

## Locked decisions

### Storage and schema

* The canonical store format is versioned JSON
* The store path is `.vscode/ai-toolkit.annotations.json` in each workspace folder
* The store root contains `schemaVersion`, `activeSessionId`, and `sessions[]`
* Each session contains its own `annotations[]`
* The extension must bundle a JSON Schema and associate it with the store file for manual editing validation
* The store file is watched for external changes and reprojected automatically after validation
* Writes use read-recalculate-write with optimistic conflict detection
* Known schema versions migrate automatically on load, with validation after migration
* Backups are created only before migrations and purge operations
* Backup naming is `.vscode/ai-toolkit.annotations.backup-{timestamp}.json`
* Only the 3 most recent backups are retained
* Backup restoration is manual in v1, not exposed as a command

### Session model

* Each session has `sessionId`, `name`, `sessionSlug`, `createdAt`, `updatedAt`, and `annotations[]`
* `sessionId` is opaque and stable
* `sessionSlug` is derived and visible, not the primary identity
* The first auto-created review session uses the default name `Review Session`
* Additional default session names increment sequentially as `Review Session 2`, `Review Session 3`, and so on
* Default numbering does not reuse gaps left by deleted sessions
* `AI Toolkit: Select Review Session` uses a Quick Pick for direct session management
* When sessions exist, the session picker lists all sessions, marks the active one, and includes `Create new session...`
* When users create a session from `AI Toolkit: Select Review Session`, the naming prompt remains explicit but starts prefilled with the next default name
* If annotation capture starts without any existing session, the extension creates `Review Session`, marks it active, and continues capture
* If annotation capture starts with existing sessions but no active session, the extension opens the session picker and resumes capture only after a session is selected or created
* If that picker is cancelled, annotation capture ends before body input is requested
* If `AI Toolkit: Select Review Session` runs with no existing session, it creates and activates `Review Session`

### Session maintenance

* `AI Toolkit: Delete Review Session` is a Command Palette command with no default keybinding
* `AI Toolkit: Delete Review Session` opens a session picker ordered by `updatedAt` descending, shows annotation counts, and marks the active session
* Deleting a session deletes the session and all annotations inside it
* If the deleted session was active and other sessions remain, the remaining session with the latest `updatedAt` becomes active
* If the deleted session was active and no sessions remain, `activeSessionId` becomes `null`
* Delete confirmation is modal and includes session name, annotation count, and whether the session is active
* Delete success messaging includes the deleted session name and the newly active session when one changes
* `AI Toolkit: Clear Review Session Annotations` is a separate Command Palette command with no default keybinding
* Clearing a session deletes all annotations in that session without deleting the session itself
* Clear confirmation is modal and includes session name and total annotation count
* If the cleared session was active, it remains the active session
* Clear success messaging includes the session name and the number of annotations removed
* Both commands remain visible in the Command Palette and return informative messages when no sessions are available

### Annotation model

* Each annotation has `annotationId`, `status`, `body`, `filePath`, `anchor`, `createdAt`, and `updatedAt`
* `annotationId` is opaque and stable
* `filePath` is stored relative to the workspace folder using `/` separators
* `status` values are `active`, `resolved`, and `dismissed`
* `anchorState` is separate from `status` and uses `anchored` or `orphaned`
* The anchor stores `range`, `selectedText`, `contextBeforeLines[]`, and `contextAfterLines[]`
* The range uses zero-based `line` and `character` coordinates matching VS Code
* `selectedText` is normalized per line and truncated to the same 200-character line limit used by context fingerprints
* The fingerprint uses 2 lines before and 2 lines after by default
* Each stored context line is truncated to a fixed maximum of 200 characters
* The number of context lines should be configurable in the future through settings
* New annotations and reanchor operations are rejected when the selected range exceeds 50 lines with content
* A selection ending at column 0 of the next line does not count that last line toward the 50-line limit

### Reanchoring and orphans

* Reanchoring prioritizes proximity to the original position first and normalized text plus fingerprint second
* If no unique and reliable match is found, the annotation becomes orphaned
* Orphaned annotations remain in the store until explicit reanchor or dismiss
* If the source file still exists, orphaned threads project at the last known range start
* If the source file no longer exists, orphaned annotations are not projected inline
* `Reanchor Annotation` uses the current selection and a short confirmation before saving

### Commands and UX

* Primary global commands:
* `AI Toolkit: Add or Edit Annotation`
* `AI Toolkit: Select Review Session`
* `AI Toolkit: Generate Draft Output`
* `AI Toolkit: Purge Dismissed Annotations`
* `AI Toolkit: Delete Review Session`
* `AI Toolkit: Clear Review Session Annotations`
* Contextual annotation actions:
* `Reanchor Annotation`
* `Dismiss Annotation`
* `Resolve Annotation`
* `Reopen Annotation`
* `Add or Edit Annotation` is available from the Command Palette and the editor context menu
* CodeLens appears only on annotated ranges to reopen the same edit flow
* New annotations use one `InputBox` for the body
* Existing annotations start with a `QuickPick` of actions, then open an `InputBox` only when editing the body
* `Dismiss Annotation` sets `status = dismissed` instead of deleting immediately
* `Purge Dismissed Annotations` removes dismissed annotations only from the active session after confirmation with a count
* `Delete Review Session` and `Clear Review Session Annotations` are destructive session-level commands that remain in the Command Palette only

### Keybindings

* The default AI Toolkit keybinding prefix is `Ctrl+Shift+A`
* Default key chords:
* `Ctrl+Shift+A, A` for `Add or Edit Annotation`
* `Ctrl+Shift+A, S` for `Select Review Session`
* `Ctrl+Shift+A, D` for `Generate Draft Output`
* Users can remap bindings individually
* The default `when` clauses should be contextual:
* annotation capture requires an active text editor and either a selection or an annotated range
* session selection requires a valid workspace folder context
* draft generation requires a valid workspace folder context and an active session

### Comment projection

* The store is the only source of truth
* Comment threads are regenerated from store state on explicit events and external store changes
* Thread identity uses `ai-toolkit:{sessionId}:{annotationId}`
* The visible thread marker is `AI Toolkit · {sessionName}`
* Only the active session is projected by default, with room for future expansion
* Each annotation projects as a single visible comment
* The visible comment uses a compact header plus the annotation body below
* Summary metadata is limited to session, status, and anchor state
* Comments from other providers are never mutated or reconciled by AI Toolkit

### Draft output

* Draft documents are untitled and named `ai-toolkit-{sessionSlug}.{ext}`
* `draftOutputFormat` is configurable as `markdown`, `json`, or `yaml`
* Markdown is organized by file
* Markdown includes a header with session name, workspace folder, and generation time
* Markdown includes a summary with counts by `status` and `anchorState`
* Markdown includes a section per file and a subsection per annotation
* JSON and YAML use a derived draft shape oriented to downstream consumers rather than mirroring the store
* Structured drafts contain root metadata plus `files[]` grouped by file path
* Drafts exclude `dismissed` annotations by default
* Drafts include `resolved` annotations, clearly marked
* Drafts include `orphaned` annotations, clearly marked and grouped visibly

### Settings

* `aiToolkit.draftOutputFormat`
* `aiToolkit.comments.showOnlyActiveSession`

### Failure handling

* Invalid store content disables projection and writes until the file is corrected
* The extension shows a clear error and offers to open the store file
* Write conflicts produce a clear notification, automatic reload from disk, and require the user to retry the action

## Architecture

### Core layers

* `Annotation Storage Controller` owns persistence concerns
* `Annotation Storage Controller` handles load, save, watch, validation, conflict detection, migrations, and destructive-operation backups
* `Annotation Workspace Service` owns application use cases and active in-memory state
* `Annotation Workspace Service` coordinates capture, edit, session switching, session maintenance, reanchor, dismiss, resolve, reopen, purge, draft generation, and refresh triggers
* `Annotation Comment Projection Service` owns translation from workspace state into VS Code comment threads

### Recommended file structure

```text
src/
  extension.ts
  annotations/
    application/
      annotationWorkspaceService.ts
      draftOutputService.ts
      sessionSelectionService.ts
    domain/
      annotationModels.ts
      annotationSchema.ts
      anchorMatching.ts
    infrastructure/
      annotationStorageController.ts
      annotationStoreWatcher.ts
      annotationBackupService.ts
    presentation/
      annotationCommentProjectionService.ts
      annotationCodeLensProvider.ts
      annotationCommands.ts
      annotationInput.ts
      sessionQuickPick.ts
  test/
    unit/
    integration/
    extension/
```

## Delivery plan

1. Foundation
Create the domain models, bundled JSON Schema, `Annotation Storage Controller`, session-store wiring, command registrations, command palette entries, context menus, keybindings, and default-session naming helpers.

2. Integration
Add `Annotation Workspace Service`, draft generation, store watching, comment projection, session picker flow, contextual editing behavior, and session-resolution logic before annotation body capture.

3. Hardening
Add reanchoring, orphan handling, dismissal, resolve and reopen, purge, clear-session, delete-session, backups, optimistic conflict handling, migration flow, and the end-to-end validation pass.

## Testing strategy

* Unit tests for storage, schema validation, migrations, backup retention, and anchor matching
* Unit tests for draft generation in Markdown, JSON, and YAML
* Unit tests for 50-line validation, including selections ending at column 0
* Unit tests for session resolution, default naming, delete-session reassignment, and clear-session behavior
* Integration tests for session selection, annotation lifecycle transitions, destructive session commands, and optimistic write conflicts
* Extension smoke tests for create annotation, auto-create first session, switch session, and comment reprojection
* Extension tests for invalid store handling and external file-change reload behavior

## Immediate implementation order

1. Replace the sample `helloWorld` command with the real command contributions and settings surface
2. Introduce domain models and the JSON Schema contract
3. Implement selection-line validation, selectedText normalization, and tests
4. Implement `Annotation Storage Controller` and tests
5. Implement `Annotation Workspace Service`, default naming, and session-resolution behavior
6. Implement command handlers, including delete-session and clear-session flows
7. Implement comment projection and CodeLens
8. Implement draft generators
9. Implement maintenance flows for reanchor, dismiss, resolve, reopen, purge, clear, and delete
10. Add conflict handling, backups, migrations, and focused extension-level tests

## Non-goals for V1

* Shared team annotation stores
* Comment editing directly inside the VS Code comments panel
* Automatic restore command for backups
* Rich classification beyond session membership, lifecycle status, and anchor state
* Database-backed storage in the first implementation
* Session renaming as a first-class workflow in this iteration
