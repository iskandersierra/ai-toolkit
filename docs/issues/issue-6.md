---
title: GitHub Issue 6
description: Copia local del issue 6 de GitHub para procesamiento, con metadatos y contenido funcional del reporte.
author: GitHub Copilot
ms.date: 2026-05-26
ms.topic: reference
keywords:
  - ai-toolkit
  - github issue
  - annotations
  - comment projection
  - context menu
estimated_reading_time: 4
---

## Fuente

* Repositorio: <https://github.com/iskandersierra/ai-toolkit>
* Issue: <https://github.com/iskandersierra/ai-toolkit/issues/6>
* Estado: Open
* Autor: `iskandersierra`
* Creado: 2026-05-26
* Labels: none
* Assignees: none
* Milestone: none

## Titulo original

Annotation comments show only session/status metadata and expose no annotation actions in the context menu

## Resumen

When an annotation is rendered as a VS Code comment, the UI currently shows only
session/status metadata such as:

> Review Session · active · anchored

but it does not show any preview of the actual annotation content.

Also, the context menu on that comment does not expose annotation-related
actions. In my case, the only visible action is `Reply`.

## Current behavior

1. The comment projection only shows the review session name and status.
2. The actual annotation text is not visible at all, not even as a short preview.
3. The context menu does not surface annotation actions such as:
   * Edit annotation
   * Resolve / Reopen
   * Dismiss
   * Reanchor
   * Other annotation-management actions as applicable

## Expected behavior

1. The rendered comment should include at least a short preview of the annotation
   body, for example the first 40-60 characters, so the user can identify the note
   without opening or hunting for it elsewhere.
2. The context menu for the annotation comment should expose the relevant
   annotation actions directly, instead of showing only `Reply`.

## Why this matters

Right now the annotation UI is hard to use because:

* multiple annotations are visually indistinguishable if they only show
  session/state metadata
* there is no quick way to manage an annotation from the place where it is
  displayed
* the feature feels incomplete even though the extension already supports
  annotation-management commands

## Steps to reproduce

1. Install `AI Toolkit`
2. Create or select a review session
3. Add an annotation with non-trivial text content
4. Open the rendered annotation comment in VS Code
5. Observe that only session/state metadata is shown
6. Right-click the comment and observe that the context menu only shows `Reply`

## Environment

* Extension: `iskandersierra.ai-toolkit`
* Version: `0.0.1`
* OS: Windows
* VS Code: `1.121.0`

## Notes

From the extension manifest, it looks like annotation-related commands already
exist, including:

* `AI Toolkit: Add or Edit Annotation`
* `AI Toolkit: Resolve Annotation`
* `AI Toolkit: Reopen Annotation`
* `AI Toolkit: Dismiss Annotation`
* `AI Toolkit: Reanchor Annotation`

So this may be a UI discoverability / menu contribution issue rather than
missing core functionality.

## Adjuntos observados

* Captura de pantalla referenciada en el issue original de GitHub

## Metadatos adicionales

* Participants: `@iskandersierra`
* Projects: none
* Development links: none
* Comments captured: none visible in the fetched issue body

## Notas de ingestión

Este documento es una copia local preparada para procesamiento. Conserva el
contenido funcional del issue y omite chrome irrelevante de la página de GitHub.
