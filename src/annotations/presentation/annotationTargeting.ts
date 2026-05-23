import * as path from 'node:path';
import * as vscode from 'vscode';
import { createAnnotationAnchor } from '../domain/anchorMatching';
import {
	createAnnotationRangeSelectedLines,
	getAnnotationRangeEffectiveEndLine,
} from '../domain/annotationModels';
import type { AnnotationProjectionEntry } from '../application/projectionModel';

export function toWorkspaceRelativeFilePath(
	workspaceFolder: vscode.WorkspaceFolder,
	documentUri: vscode.Uri,
): string | undefined {
	if (documentUri.scheme !== 'file') {
		return undefined;
	}

	const relativePath = path.relative(workspaceFolder.uri.fsPath, documentUri.fsPath);

	if (relativePath.startsWith('..') || isAbsolutePathResult(relativePath)) {
		return undefined;
	}

	return relativePath.replace(/\\/g, '/');
}

function isAbsolutePathResult(filePath: string): boolean {
	return path.isAbsolute(filePath) || /^[A-Za-z]:[\\/]/.test(filePath) || /^\\\\/.test(filePath);
}

export function createAnchorFromEditorSelection(editor: vscode.TextEditor) {
	const selection = normalizeSelection(editor.selection);
	const range = selectionToRange(selection);
	const contextBeforeLines = collectContextBeforeLines(editor.document, selection.start.line, 2);
	const contextAfterLines = collectContextAfterLines(
		editor.document,
		getAnnotationRangeEffectiveEndLine(range),
		2,
	);

	return createAnnotationAnchor(
		range,
		collectSelectedLines(editor.document, selection),
		contextBeforeLines,
		contextAfterLines,
	);
}

export function findAnnotationForEditorSelection(
	annotations: readonly AnnotationProjectionEntry[],
	filePath: string,
	selection: vscode.Selection,
): AnnotationProjectionEntry | undefined {
	const normalizedSelection = normalizeSelection(selection);

	return annotations.find((annotation) => {
		if (annotation.filePath !== filePath) {
			return false;
		}

		if (selection.isEmpty) {
			return containsPosition(annotation.range, normalizedSelection.active);
		}

		return rangesEqual(annotation.range, selectionToRange(normalizedSelection));
	});
}

export type AnnotationTargetingResult =
	| { kind: 'found'; annotation: AnnotationProjectionEntry }
	| { kind: 'conflict' }
	| { kind: 'none' };

function rangesOverlap(
	a: { start: { line: number; character: number }; end: { line: number; character: number } },
	b: { start: { line: number; character: number }; end: { line: number; character: number } },
): boolean {
	if (a.end.line < b.start.line || b.end.line < a.start.line) {
		return false;
	}
	if (a.end.line === b.start.line && a.end.character <= b.start.character) {
		return false;
	}
	if (b.end.line === a.start.line && b.end.character <= a.start.character) {
		return false;
	}
	return true;
}

export function resolveAnnotationTarget(
	annotations: readonly AnnotationProjectionEntry[],
	filePath: string,
	selection: vscode.Selection,
): AnnotationTargetingResult {
	if (selection.isEmpty) {
		const found = findAnnotationForEditorSelection(annotations, filePath, selection);
		return found ? { kind: 'found', annotation: found } : { kind: 'none' };
	}
	const normalizedRange = selectionToRange(selection);
	const matches = annotations.filter(
		(a) => a.filePath === filePath && rangesOverlap(a.range, normalizedRange),
	);
	if (matches.length === 0) {
		return { kind: 'none' };
	}
	if (matches.length === 1) {
		return { kind: 'found', annotation: matches[0] };
	}
	return { kind: 'conflict' };
}

function collectContextBeforeLines(
	document: vscode.TextDocument,
	startLine: number,
	count: number,
): string[] {
	const lines: string[] = [];
	const firstLine = Math.max(0, startLine - count);

	for (let line = firstLine; line < startLine; line += 1) {
		lines.push(document.lineAt(line).text);
	}

	return lines;
}

function collectContextAfterLines(
	document: vscode.TextDocument,
	endLine: number,
	count: number,
): string[] {
	const lines: string[] = [];
	const lastLine = Math.min(document.lineCount - 1, endLine + count);

	for (let line = endLine + 1; line <= lastLine; line += 1) {
		lines.push(document.lineAt(line).text);
	}

	return lines;
}

function normalizeSelection(selection: vscode.Selection): vscode.Selection {
	return selection.isReversed
		? new vscode.Selection(selection.end, selection.start)
		: selection;
}

function selectionToRange(selection: vscode.Selection) {
	return {
		start: { line: selection.start.line, character: selection.start.character },
		end: { line: selection.end.line, character: selection.end.character },
	};
}

function collectSelectedLines(document: vscode.TextDocument, selection: vscode.Selection): string[] {
	const lines = Array.from({ length: document.lineCount }, (_, line) => document.lineAt(line).text);

	return createAnnotationRangeSelectedLines(selectionToRange(selection), lines) ?? [];
}

function rangesEqual(
	left: { start: { line: number; character: number }; end: { line: number; character: number } },
	right: { start: { line: number; character: number }; end: { line: number; character: number } },
): boolean {
	return (
		left.start.line === right.start.line &&
		left.start.character === right.start.character &&
		left.end.line === right.end.line &&
		left.end.character === right.end.character
	);
}

function containsPosition(
	range: { start: { line: number; character: number }; end: { line: number; character: number } },
	position: vscode.Position,
): boolean {
	return comparePosition(range.start, position) <= 0 && comparePosition(range.end, position) >= 0;
}

function comparePosition(
	left: { line: number; character: number },
	right: { line: number; character: number },
): number {
	if (left.line !== right.line) {
		return left.line - right.line;
	}

	return left.character - right.character;
}