import * as path from 'node:path';
import * as vscode from 'vscode';
import { createAnnotationAnchor } from '../domain/anchorMatching';
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
	const contextBeforeLines = collectContextBeforeLines(editor.document, selection.start.line, 2);
	const contextAfterLines = collectContextAfterLines(editor.document, selection.end.line, 2);

	return createAnnotationAnchor(
		selectionToRange(selection),
		editor.document.getText(selection),
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