---
title: AI Toolkit
description: VS Code extension for review-session annotations, anchored comment workflows, and draft output generation.
author: GitHub Copilot
ms.date: 2026-05-24
ms.topic: overview
keywords:
	- vscode extension
	- annotations
	- review workflow
	- draft output
estimated_reading_time: 2
---

## Overview

AI Toolkit is a Visual Studio Code extension for capturing review annotations in workspace files, projecting them into the editor and comments UI, and generating structured draft output from active review sessions.

## Features

* Add or edit anchored annotations directly from the editor or comment context menu
* Organize annotations by review session and switch between active sessions
* Reanchor, dismiss, resolve, and reopen tracked annotations
* Generate draft output in Markdown, JSON, or YAML from the active session
* Validate annotation files against the bundled JSON schema

## Requirements

* Visual Studio Code 1.120.0 or later

## Extension Settings

This extension contributes the following settings:

* `aiToolkit.draftOutputFormat`: Select the generated draft output format
* `aiToolkit.comments.showOnlyActiveSession`: Limit comment projections to the active review session

## Annotation Storage

AI Toolkit stores annotation data in `.vscode/ai-toolkit.annotations.json` inside the workspace. The extension also contributes JSON validation for that file.

## Release Notes

See [CHANGELOG.md](./CHANGELOG.md) for the current release history.
