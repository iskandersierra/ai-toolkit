import * as assert from 'assert';
import * as vscode from 'vscode';
import { createAnnotationAnchor } from '../../annotations/domain/anchorMatching';
import {
	annotationContextKeyIds,
	registerAnnotationContextKeys,
} from '../../annotations/bootstrap/annotationContextKeys';
import { deriveAnnotationWorkspaceProjection } from '../../annotations/application/projectionModel';
import {
	annotationSchemaVersion,
	type AnnotationStore,
} from '../../annotations/domain/annotationModels';
import type { AnnotationWorkspaceServiceLike } from '../../annotations/application/annotationWorkspaceService';

suite('Annotation Context Keys', () => {
	// Scenario: refresh failures reset annotation context keys to a safe false state.
	test('resets context keys when refresh fails', async () => {
		const commandCalls: Array<{ key: string; value: boolean }> = [];
		let shouldReject = false;
		const context = createExtensionContext();
		const windowApi = createWindowApi(createEditor());
		const readyState = createReadyState();

		const controller = registerAnnotationContextKeys(context, {
			window: windowApi,
			commands: {
				executeCommand: (async <T = unknown>(_command: string, key: string, value: boolean) => {
					commandCalls.push({ key, value });
					return undefined as T;
				}) as typeof vscode.commands.executeCommand,
			},
			getWorkspaceService: async () => {
				if (shouldReject) {
					throw new Error('refresh failed');
				}

				return createWorkspaceService(readyState);
			},
		});

		await flushAsyncWork();
		commandCalls.length = 0;

		await controller.refresh();
		assert.deepStrictEqual(commandCalls, [
			{ key: annotationContextKeyIds.canManage, value: true },
			{ key: annotationContextKeyIds.hasActiveSession, value: true },
		]);

		shouldReject = true;
		commandCalls.length = 0;

		await controller.refresh();

		assert.deepStrictEqual(commandCalls, [
			{ key: annotationContextKeyIds.canManage, value: false },
			{ key: annotationContextKeyIds.hasActiveSession, value: false },
		]);
	});

	// Scenario: controller disposal owns editor listener cleanup without relying on duplicated context subscriptions.
	test('disposes editor listeners exactly once through the controller', () => {
		const activeEditorDisposable = createDisposableSpy();
		const selectionDisposable = createDisposableSpy();
		const context = createExtensionContext();

		const controller = registerAnnotationContextKeys(context, {
			window: {
				activeTextEditor: undefined,
				onDidChangeActiveTextEditor: () => activeEditorDisposable,
				onDidChangeTextEditorSelection: () => selectionDisposable,
			},
			commands: {
				executeCommand: (async <T = unknown>() => undefined as T) as typeof vscode.commands.executeCommand,
			},
			getWorkspaceService: async () => createWorkspaceService(createReadyState()),
		});

		controller.dispose();
		for (const disposable of context.subscriptions) {
			disposable.dispose();
		}

		assert.strictEqual(context.subscriptions.length, 0);
		assert.strictEqual(activeEditorDisposable.disposeCount, 1);
		assert.strictEqual(selectionDisposable.disposeCount, 1);
	});
});

function createExtensionContext(): vscode.ExtensionContext {
	return {
		subscriptions: [],
	} as unknown as vscode.ExtensionContext;
}

function createWindowApi(activeTextEditor: vscode.TextEditor | undefined) {
	return {
		activeTextEditor,
		onDidChangeActiveTextEditor: () => ({ dispose() {} }),
		onDidChangeTextEditorSelection: () => ({ dispose() {} }),
	};
}

function createEditor(): vscode.TextEditor {
	return {
		document: {
			uri: vscode.Uri.file('e:/source/ai-toolkit/src/extension.ts'),
		},
		selection: new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 8)),
	} as vscode.TextEditor;
}

function createWorkspaceService(state: ReturnType<typeof createReadyState>): AnnotationWorkspaceServiceLike {
	return {
		getState: () => state,
		initialize: async () => state,
		createSession: async () => {
			throw new Error('Not implemented in test');
		},
		setActiveSession: async () => {
			throw new Error('Not implemented in test');
		},
		createAnnotation: async () => {
			throw new Error('Not implemented in test');
		},
		updateAnnotation: async () => {
			throw new Error('Not implemented in test');
		},
		dismissAnnotation: async () => {
			throw new Error('Not implemented in test');
		},
		purgeDismissedAnnotations: async () => {
			throw new Error('Not implemented in test');
		},
		reanchorAnnotation: async () => {
			throw new Error('Not implemented in test');
		},
		generateDraftOutput: async () => {
			throw new Error('Not implemented in test');
		},
	};
}

function createReadyState() {
	return {
		status: 'ready' as const,
		storePath: 'e:/source/ai-toolkit/.vscode/ai-toolkit.annotations.json',
		projection: deriveAnnotationWorkspaceProjection('e:/source/ai-toolkit', createStore()),
	};
}

function createStore(): AnnotationStore {
	return {
		schemaVersion: annotationSchemaVersion,
		activeSessionId: 'session-1',
		sessions: [
			{
				sessionId: 'session-1',
				name: 'Security review',
				sessionSlug: 'security-review',
				createdAt: '2026-05-20T10:00:00.000Z',
				updatedAt: '2026-05-20T10:00:00.000Z',
				annotations: [
					{
						annotationId: 'annotation-1',
						status: 'active',
						anchorState: 'anchored',
						body: 'Body',
						filePath: 'src/extension.ts',
						createdAt: '2026-05-20T10:05:00.000Z',
						updatedAt: '2026-05-20T10:05:00.000Z',
						anchor: createAnnotationAnchor(
							{
								start: { line: 0, character: 0 },
								end: { line: 0, character: 8 },
							},
							'target()',
							[],
							[],
						),
					},
				],
			},
		],
	};
}

function createDisposableSpy(): vscode.Disposable & { disposeCount: number } {
	return {
		disposeCount: 0,
		dispose() {
			this.disposeCount += 1;
		},
	};
}

async function flushAsyncWork(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}