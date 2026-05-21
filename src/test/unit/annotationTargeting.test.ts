import * as assert from 'assert';
import * as vscode from 'vscode';
import { toWorkspaceRelativeFilePath } from '../../annotations/presentation/annotationTargeting';

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
});

function workspaceFolder(fsPath: string): vscode.WorkspaceFolder {
	return {
		uri: vscode.Uri.file(fsPath),
		index: 0,
		name: 'ai-toolkit',
	};
}