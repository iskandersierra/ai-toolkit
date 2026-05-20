---
title: AI Toolkit Annotation V1 Implementation Plan
description: Technical implementation plan for the first AI Toolkit annotation workflow, including storage, commands, comment projection, draft generation, and validation.
author: GitHub Copilot
ms.date: 2026-05-20
ms.topic: how-to
keywords:
  - ai-toolkit
  - vscode extension
  - annotations
  - implementation plan
estimated_reading_time: 8
---

## Goal

Implement the first end-to-end annotation workflow for AI Toolkit as a Visual Studio Code extension. The first version must let a user capture annotations on code ranges, organize them into review sessions, project them into the comments panel, generate draft outputs, and keep the workspace-local store as the single source of truth.

## Scope

* Store annotations per workspace folder in `.vscode/ai-toolkit.annotations.json`
* Keep the persisted store as canonical and the comments UI as a derived projection
* Support multiple review sessions with one active session per workspace folder
* Expose the first command surface, keybinding family, and comment projection behavior
* Generate draft outputs in Markdown, JSON, or YAML from the active session
* Validate the store with a bundled JSON Schema and runtime validation
* Handle reanchoring, dismissal, purge of dismissed annotations, backups, and optimistic writes

## Locked Decisions

### Storage And Schema

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

### Session Model

* Each session has `sessionId`, `name`, `sessionSlug`, `createdAt`, `updatedAt`, and `annotations[]`
* `sessionId` is opaque and stable
* `sessionSlug` is derived and visible, not the primary identity
* `AI Toolkit: Select Review Session` uses a single Quick Pick
* The session picker lists all sessions, marks the active one, and includes `Create new session...`
* If annotation capture starts without an active session, the extension opens the session picker and resumes capture after selection

### Annotation Model

* Each annotation has `annotationId`, `status`, `body`, `filePath`, `anchor`, `createdAt`, and `updatedAt`
* `annotationId` is opaque and stable
* `filePath` is stored relative to the workspace folder using `/` separators
* `status` values are `active`, `resolved`, and `dismissed`
* `anchorState` is separate from `status` and uses `anchored` or `orphaned`
* The anchor stores `range`, `selectedText`, `contextBeforeLines[]`, and `contextAfterLines[]`
* The range uses zero-based `line` and `character` coordinates matching VS Code
* `selectedText` is preserved exactly as captured
* The fingerprint uses 2 lines before and 2 lines after by default
* Each stored context line is truncated to a fixed maximum of 200 characters
* The number of context lines should be configurable in the future through settings
* New annotations are rejected when `selectedText` exceeds 2000 characters

### Reanchoring And Orphans

* Reanchoring tries exact range matching first and fingerprint matching second
* If no unique and reliable match is found, the annotation becomes orphaned
* Orphaned annotations remain in the store until explicit reanchor or dismiss
* If the source file still exists, orphaned threads project at the last known range start
* If the source file no longer exists, orphaned annotations are not projected inline
* `Reanchor Annotation` uses the current selection and a short confirmation before saving

### Commands And UX

* Primary global commands:
* `AI Toolkit: Add or Edit Annotation`
* `AI Toolkit: Select Review Session`
* `AI Toolkit: Generate Draft Output`
* `AI Toolkit: Purge Dismissed Annotations`
* Contextual annotation actions:
* `Reanchor Annotation`
* `Dismiss Annotation`
* `Add or Edit Annotation` is available from the Command Palette and the editor context menu
* CodeLens appears only on annotated ranges to reopen the same edit flow
* New annotations use one `InputBox` for the body
* Existing annotations start with a `QuickPick` of actions, then open an `InputBox` only when editing the body
* `Dismiss Annotation` sets `status = dismissed` instead of deleting immediately
* `Purge Dismissed Annotations` removes dismissed annotations only from the active session after confirmation with a count

### Keybindings

* The default AI Toolkit keybinding prefix is `Ctrl+Alt+A`
* Default key chords:
* `Ctrl+Alt+A, A` for `Add or Edit Annotation`
* `Ctrl+Alt+A, S` for `Select Review Session`
* `Ctrl+Alt+A, D` for `Generate Draft Output`
* Users can remap bindings individually
* The default `when` clauses should be contextual:
* annotation capture requires an active text editor and either a selection or an annotated range
* session selection requires a valid workspace folder context
* draft generation requires a valid workspace folder context and an active session

### Comment Projection

* The store is the only source of truth
* Comment threads are regenerated from store state on explicit events and external store changes
* Thread identity uses `ai-toolkit:{sessionId}:{annotationId}`
* The visible thread marker is `AI Toolkit · {sessionName}`
* Only the active session is projected by default, with room for future expansion
* Each annotation projects as a single visible comment
* The visible comment uses a compact header plus the annotation body below
* Summary metadata is limited to session, status, and anchor state
* Comments from other providers are never mutated or reconciled by AI Toolkit

### Draft Output

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

### Failure Handling

* Invalid store content disables projection and writes until the file is corrected
* The extension shows a clear error and offers to open the store file
* Write conflicts produce a clear notification, automatic reload from disk, and require the user to retry the action

## Architecture

### Core Layers

* `Annotation Storage Controller` owns persistence concerns
* `Annotation Storage Controller` handles load, save, watch, validation, conflict detection, migrations, and destructive-operation backups
* `Annotation Workspace Service` owns application use cases and active in-memory state
* `Annotation Workspace Service` coordinates capture, edit, session switching, reanchor, dismiss, purge, draft generation, and refresh triggers
* `Annotation Comment Projection Service` owns translation from workspace state into VS Code comment threads

### Recommended File Structure

```text
src/
  extension.ts
  annotations/
    application/
      annotationWorkspaceService.ts
      draftOutputService.ts
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
      sessionQuickPick.ts
  test/
    unit/
    integration/
    extension/
```

## Data Contracts

### Store Root Shape

```json
{
  "schemaVersion": 1,
  "activeSessionId": "01J...",
  "sessions": [
    {
      "sessionId": "01J...",
      "name": "Security pass",
      "sessionSlug": "security-pass",
      "createdAt": "2026-05-20T10:00:00.000Z",
      "updatedAt": "2026-05-20T10:15:00.000Z",
      "annotations": [
        {
          "annotationId": "01J...",
          "status": "active",
          "anchorState": "anchored",
          "body": "Validate this boundary before invoking the tool.",
          "filePath": "src/extension.ts",
          "createdAt": "2026-05-20T10:05:00.000Z",
          "updatedAt": "2026-05-20T10:05:00.000Z",
          "anchor": {
            "range": {
              "start": { "line": 10, "character": 4 },
              "end": { "line": 12, "character": 18 }
            },
            "selectedText": "context.subscriptions.push(disposable);",
            "contextBeforeLines": [
              "\t});",
              ""
            ],
            "contextAfterLines": [
              "}",
              ""
            ]
          }
        }
      ]
    }
  ]
}
```

### Draft Shape For JSON Or YAML

```json
{
  "generatedAt": "2026-05-20T10:30:00.000Z",
  "workspaceFolder": "ai-toolkit",
  "session": {
    "sessionId": "01J...",
    "name": "Security pass",
    "sessionSlug": "security-pass"
  },
  "files": [
    {
      "filePath": "src/extension.ts",
      "annotations": [
        {
          "annotationId": "01J...",
          "status": "active",
          "anchorState": "anchored",
          "range": {
            "start": { "line": 10, "character": 4 },
            "end": { "line": 12, "character": 18 }
          },
          "body": "Validate this boundary before invoking the tool."
        }
      ]
    }
  ]
}
```

## Delivery Plan

1. Foundation
Create the domain models, bundled JSON Schema, `Annotation Storage Controller`, session/store wiring, command registrations, command palette entries, context menus, and keybindings.

2. Integration
Add `Annotation Workspace Service`, draft generation, store watching, comment projection, session picker flow, and contextual editing behavior.

3. Hardening
Add reanchoring, orphan handling, dismissal, purge, backups, optimistic conflict handling, migration flow, and the end-to-end validation pass.

## Testing Strategy

* Unit tests for storage, schema validation, migrations, backup retention, and anchor matching
* Unit tests for draft generation in Markdown, JSON, and YAML
* Integration tests for session selection, annotation lifecycle transitions, and optimistic write conflicts
* Extension smoke tests for create annotation, switch session, and comment reprojection
* Extension tests for invalid store handling and external file-change reload behavior

## Immediate Implementation Order

1. Replace the sample `helloWorld` command with the real command contributions and settings surface
2. Introduce domain models and the JSON Schema contract
3. Implement `Annotation Storage Controller` and tests
4. Implement `Annotation Workspace Service` and tests
5. Implement command handlers and session picker flow
6. Implement comment projection and CodeLens
7. Implement draft generators
8. Implement maintenance flows for reanchor, dismiss, and purge
9. Add conflict handling, backups, and migration behavior
10. Finish with focused extension-level tests

## Non-Goals For V1

* Shared team annotation stores
* Comment editing directly inside the VS Code comments panel
* Automatic restore command for backups
* Rich classification beyond session membership, lifecycle status, and anchor state
* Database-backed storage in the first implementation
