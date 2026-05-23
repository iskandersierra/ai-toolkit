import * as assert from 'assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	findWorkspaceFolderForEditor,
	findWorkspaceFolderForPaletteCommand,
} from '../../annotations/util/workspaceFolders';

const createdFixtureUris: vscode.Uri[] = [];
let fixtureCounter = 0;

suite('Workspace Folders', () => {
	suiteTeardown(async () => {
		await Promise.all(
			createdFixtureUris.map(async (uri) => {
				try {
					await vscode.workspace.fs.delete(uri);
				} catch {
					// Ignore best-effort fixture cleanup failures.
				}
			}),
		);
	});

	// Scenario: Given a saved file editor inside the workspace, When findWorkspaceFolderForEditor runs, Then it returns that workspace folder.
	test('finds the workspace folder for a file-backed editor', async () => {
		const editor = await openEditor('export function activate() {}');

		const result = findWorkspaceFolderForEditor(editor);

		assert.strictEqual(result?.uri.fsPath, workspaceFolder().uri.fsPath);
	});

	// Scenario: Given an untitled editor, When findWorkspaceFolderForEditor runs, Then it returns undefined.
	test('returns undefined for a non-file editor', async () => {
		const document = await vscode.workspace.openTextDocument({ content: 'draft' });
		const editor = await vscode.window.showTextDocument(document);

		const result = findWorkspaceFolderForEditor(editor);

		assert.strictEqual(result, undefined);
	});

	// Scenario: Given a single-folder workspace, When findWorkspaceFolderForPaletteCommand runs, Then it returns that sole workspace folder.
	test('returns the sole workspace folder for palette commands', () => {
		const result = findWorkspaceFolderForPaletteCommand();

		assert.strictEqual(result?.uri.fsPath, workspaceFolder().uri.fsPath);
	});
});

function workspaceFolder(): vscode.WorkspaceFolder {
	return {
		uri: vscode.Uri.file('e:/source/ai-toolkit'),
		index: 0,
		name: 'ai-toolkit',
	};
}

async function openEditor(content: string): Promise<vscode.TextEditor> {
	const fixtureUri = vscode.Uri.file(
		path.join(workspaceFolder().uri.fsPath, `.workspace-folders-fixture-${fixtureCounter += 1}.ts`),
	);
	createdFixtureUris.push(fixtureUri);
	await vscode.workspace.fs.writeFile(fixtureUri, new TextEncoder().encode(content));
	const document = await vscode.workspace.openTextDocument(fixtureUri);
	return vscode.window.showTextDocument(document);
}