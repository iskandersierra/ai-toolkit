import * as assert from 'assert';
import * as vscode from 'vscode';
import {
	annotationCommandIds,
	type AnnotationCommandResult,
} from '../annotations/bootstrap/registerAnnotationFeature';

suite('Annotation Bootstrap', () => {
	teardown(async () => {
		await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
	});

	// Scenario: activation registers the annotation command surface for the extension host.
	test('registers the phase 1 annotation commands', async () => {
		await vscode.commands.executeCommand(annotationCommandIds.selectReviewSession);
		const commands = await vscode.commands.getCommands(true);

		for (const commandId of Object.values(annotationCommandIds)) {
			assert.ok(commands.includes(commandId), `Expected command to be registered: ${commandId}`);
		}
	});

	// Scenario: a workspace-scoped palette command resolves the single workspace folder during bootstrap.
	test('select review session resolves the workspace folder', async () => {
		const result = await vscode.commands.executeCommand<AnnotationCommandResult>(
			annotationCommandIds.selectReviewSession,
		);
		const hasSingleWorkspaceFolder = vscode.workspace.workspaceFolders?.length === 1;

		assert.ok(result);
		assert.strictEqual(result?.status, hasSingleWorkspaceFolder ? 'ready' : 'blocked');

		if (hasSingleWorkspaceFolder && result?.status === 'ready') {
			assert.ok(result.workspaceFolder);
			assert.strictEqual(result.operation, 'reviewSessionSelected');
			return;
		}

		assert.deepStrictEqual(result, {
			status: 'blocked',
			commandId: annotationCommandIds.selectReviewSession,
			reason: 'noWorkspaceFolder',
			message: 'AI Toolkit annotations require a saved file inside a workspace folder.',
		});
	});

	// Scenario: an editor-driven annotation command is blocked for an unsaved document outside the workspace.
	test('add or edit annotation blocks untitled editors', async () => {
		const document = await vscode.workspace.openTextDocument({ content: 'annotation draft' });
		await vscode.window.showTextDocument(document);

		const result = await vscode.commands.executeCommand<AnnotationCommandResult>(
			annotationCommandIds.addOrEditAnnotation,
		);

		assert.deepStrictEqual(result, {
			status: 'blocked',
			commandId: annotationCommandIds.addOrEditAnnotation,
			reason: 'noWorkspaceFolder',
			message: 'AI Toolkit annotations require a saved file inside a workspace folder.',
		});
	});
});
