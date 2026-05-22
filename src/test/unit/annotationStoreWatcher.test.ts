import * as assert from 'assert';
import * as vscode from 'vscode';
import { annotationStoreRelativePath } from '../../annotations/domain/annotationSchema';
import { AnnotationStoreWatcher } from '../../annotations/infrastructure/annotationStoreWatcher';
import type { AnnotationLogger } from '../../annotations/util/log';
import {
	getMockFileSystemWatchers,
	resetMockFileSystemWatchers,
} from '../support/vscode.mock';

suite('Annotation Store Watcher', () => {
	setup(() => {
		resetMockFileSystemWatchers();
	});

	// Scenario: store watcher subscribes to the annotation store path and forwards filesystem events.
	test('wires the workspace watcher and forwards create change and delete events', () => {
		const events: Array<{ kind: 'created' | 'changed' | 'deleted'; uri: vscode.Uri }> = [];
		const logEntries: Array<{ message: string; details?: Record<string, unknown> }> = [];
		const logger: AnnotationLogger = {
			info: (message, details) => {
				logEntries.push({ message, details });
			},
			warn: () => undefined,
			error: () => undefined,
		};
		const workspaceFolder = createWorkspaceFolder('e:/source/ai-toolkit');

		new AnnotationStoreWatcher(workspaceFolder, (event) => {
			events.push(event);
		}, logger);

		const [watcher] = getMockFileSystemWatchers();
		assert.ok(watcher);
		assert.strictEqual(watcher.pattern.base, workspaceFolder);
		assert.strictEqual(watcher.pattern.pattern, annotationStoreRelativePath);

		const createdUri = vscode.Uri.file('e:/source/ai-toolkit/.vscode/ai-toolkit.annotations.json');
		const changedUri = vscode.Uri.file('e:/source/ai-toolkit/.vscode/ai-toolkit.annotations.json');
		const deletedUri = vscode.Uri.file('e:/source/ai-toolkit/.vscode/ai-toolkit.annotations.json');

		watcher.fireCreate(createdUri);
		watcher.fireChange(changedUri);
		watcher.fireDelete(deletedUri);

		assert.deepStrictEqual(events, [
			{ kind: 'created', uri: createdUri },
			{ kind: 'changed', uri: changedUri },
			{ kind: 'deleted', uri: deletedUri },
		]);
		assert.deepStrictEqual(logEntries, [
			{
				message: 'Reloading annotation store state.',
				details: { storePath: createdUri.fsPath, reason: 'created' },
			},
			{
				message: 'Reloading annotation store state.',
				details: { storePath: changedUri.fsPath, reason: 'changed' },
			},
			{
				message: 'Reloading annotation store state.',
				details: { storePath: deletedUri.fsPath, reason: 'deleted' },
			},
		]);
	});

	// Scenario: disposing the wrapper watcher disposes the underlying VS Code watcher instance.
	test('disposes the underlying file system watcher', () => {
		const annotationStoreWatcher = new AnnotationStoreWatcher(
			createWorkspaceFolder('e:/source/ai-toolkit'),
			() => undefined,
			createSilentLogger(),
		);

		const [watcher] = getMockFileSystemWatchers();
		assert.ok(watcher);
		assert.strictEqual(watcher.isDisposed, false);

		annotationStoreWatcher.dispose();

		assert.strictEqual(watcher.isDisposed, true);
	});
});

function createWorkspaceFolder(fsPath: string): vscode.WorkspaceFolder {
	return {
		uri: vscode.Uri.file(fsPath),
		index: 0,
		name: 'ai-toolkit',
	};
}

function createSilentLogger(): AnnotationLogger {
	return {
		info: () => undefined,
		warn: () => undefined,
		error: () => undefined,
	};
}