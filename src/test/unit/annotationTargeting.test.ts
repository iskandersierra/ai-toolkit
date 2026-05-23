import * as assert from 'assert';
import * as vscode from 'vscode';
import {
	createAnchorFromEditorSelection,
	toWorkspaceRelativeFilePath,
	resolveAnnotationTarget,
} from '../../annotations/presentation/annotationTargeting';
import type { AnnotationProjectionEntry } from '../../annotations/application/projectionModel';

suite('Annotation Targeting', () => {
	// Scenario: file-backed annotation targeting keeps paths relative to the active workspace folder.
	test('returns normalized workspace-relative paths for files inside the workspace', () => {
		const relativePath = toWorkspaceRelativeFilePath(workspaceFolder('e:/source/ai-toolkit'), vscode.Uri.file('e:/source/ai-toolkit/src/extension.ts'));

		assert.strictEqual(relativePath, 'src/extension.ts');
	});

	// Scenario: Windows cross-drive files are rejected before they enter the annotation flow.
	test('rejects Windows cross-drive file paths', function () {
		if (process.platform !== 'win32') {
			this.skip();
		}

		const relativePath = toWorkspaceRelativeFilePath(
			workspaceFolder('e:/source/ai-toolkit'),
			vscode.Uri.file('d:/outside/file.ts'),
		);

		assert.strictEqual(relativePath, undefined);
	});

	// Scenario: Given a multi-line selection ending at column 0, When an anchor is captured, Then contextAfterLines starts with the first unselected line.
	test('captures post-selection context from the effective end line for trailing-column-0 selections', async () => {
		const document = await vscode.workspace.openTextDocument({
			content: ['before', 'target()', 'after a', 'after b'].join('\n'),
			language: 'typescript',
		});
		const editor = await vscode.window.showTextDocument(document);
		editor.selection = new vscode.Selection(new vscode.Position(1, 0), new vscode.Position(2, 0));

		const anchor = createAnchorFromEditorSelection(editor);

		assert.deepStrictEqual(anchor.selectedLines, ['target()']);
		assert.deepStrictEqual(anchor.contextAfterLines, ['after a', 'after b']);
		await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
	});
});

function workspaceFolder(fsPath: string): vscode.WorkspaceFolder {
	return {
		uri: vscode.Uri.file(fsPath),
		index: 0,
		name: 'ai-toolkit',
	};
}

function makeProjectionEntry(
	annotationId: string,
	entryFilePath: string,
	start: [number, number],
	end: [number, number],
): AnnotationProjectionEntry {
	return {
		annotationId,
		sessionId: 'session-1',
		sessionName: 'Test Session',
		status: 'active',
		anchorState: 'anchored',
		body: 'Test body',
		filePath: entryFilePath,
		range: {
			start: { line: start[0], character: start[1] },
			end: { line: end[0], character: end[1] },
		},
		updatedAt: '2026-05-22T00:00:00.000Z',
		isActiveSession: true,
	};
}

suite('resolveAnnotationTarget', () => {
	const filePath = 'src/extension.ts';

	const entry1 = makeProjectionEntry('annotation-1', filePath, [5, 0], [5, 20]);
	const entry2 = makeProjectionEntry('annotation-2', filePath, [10, 0], [10, 30]);
	const entry3 = makeProjectionEntry('annotation-3', filePath, [5, 5], [5, 25]);

	// Scenario: Given a non-empty selection overlapping exactly one annotation, When resolveAnnotationTarget is called, Then it returns found with that annotation.
	test('non-empty selection overlapping exactly one annotation returns found', () => {
		const selection = new vscode.Selection(new vscode.Position(5, 0), new vscode.Position(5, 20));
		const result = resolveAnnotationTarget([entry1, entry2], filePath, selection);
		assert.deepStrictEqual(result, { kind: 'found', annotation: entry1 });
	});

	// Scenario: Given a non-empty selection overlapping two annotations, When resolveAnnotationTarget is called, Then it returns conflict.
	test('non-empty selection overlapping two annotations returns conflict', () => {
		const selection = new vscode.Selection(new vscode.Position(5, 0), new vscode.Position(5, 26));
		const result = resolveAnnotationTarget([entry1, entry3], filePath, selection);
		assert.deepStrictEqual(result, { kind: 'conflict' });
	});

	// Scenario: Given a non-empty selection with no overlap with any annotation, When resolveAnnotationTarget is called, Then it returns none.
	test('non-empty selection with no overlap returns none', () => {
		const selection = new vscode.Selection(new vscode.Position(3, 0), new vscode.Position(3, 10));
		const result = resolveAnnotationTarget([entry1, entry2], filePath, selection);
		assert.deepStrictEqual(result, { kind: 'none' });
	});

	// Scenario: Given an empty cursor selection positioned within an annotated range, When resolveAnnotationTarget is called, Then it returns found with that annotation.
	test('empty selection on annotated position returns found', () => {
		const selection = new vscode.Selection(new vscode.Position(5, 10), new vscode.Position(5, 10));
		const result = resolveAnnotationTarget([entry1, entry2], filePath, selection);
		assert.deepStrictEqual(result, { kind: 'found', annotation: entry1 });
	});

	// Scenario: Given an empty cursor selection outside any annotated range, When resolveAnnotationTarget is called, Then it returns none.
	test('empty selection outside annotated range returns none', () => {
		const selection = new vscode.Selection(new vscode.Position(3, 0), new vscode.Position(3, 0));
		const result = resolveAnnotationTarget([entry1, entry2], filePath, selection);
		assert.deepStrictEqual(result, { kind: 'none' });
	});
});