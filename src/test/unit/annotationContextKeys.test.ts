import * as assert from 'assert';
import * as vscode from 'vscode';
import { createAnnotationAnchor } from '../../annotations/domain/anchorMatching';
import {
	annotationContextKeyIds,
	type AnnotationContextKeyDependencies,
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

	// Scenario: overlapping refreshes publish only the newest editor state.
	test('ignores stale refresh completions when a newer refresh finishes first', async () => {
		const commandCalls: Array<{ key: string; value: boolean }> = [];
		const context = createExtensionContext();
		const firstRefresh = createDeferred<void>();
		const newerState = createReadyState({ activeSessionId: null, annotations: [] });
		const olderState = createReadyState();
		const editorOne = createEditor('e:/source/ai-toolkit/src/extension.ts');
		const editorTwo = createEditor('e:/source/ai-toolkit/src/other.ts');
		const windowApi: AnnotationContextKeyDependencies['window'] = {
			activeTextEditor: undefined,
			onDidChangeActiveTextEditor: () => ({ dispose() {} }),
			onDidChangeTextEditorSelection: () => ({ dispose() {} }),
		};

		const controller = registerAnnotationContextKeys(context, {
			window: windowApi,
			commands: {
				executeCommand: (async <T = unknown>(_command: string, key: string, value: boolean) => {
					commandCalls.push({ key, value });
					return undefined as T;
				}) as typeof vscode.commands.executeCommand,
			},
			getWorkspaceService: async (workspaceFolder) => {
				if (windowApi.activeTextEditor === editorOne) {
					await firstRefresh.promise;
					return createWorkspaceService(olderState, workspaceFolder.uri.fsPath);
				}

				return createWorkspaceService(newerState, workspaceFolder.uri.fsPath);
			},
		});

		await flushAsyncWork();
		commandCalls.length = 0;

		windowApi.activeTextEditor = editorOne;
		const staleRefreshPromise = controller.refresh();

		windowApi.activeTextEditor = editorTwo;
		await controller.refresh();

		firstRefresh.resolve();
		await staleRefreshPromise;

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

function createEditor(filePath = 'e:/source/ai-toolkit/src/extension.ts'): vscode.TextEditor {
	return {
		document: {
			uri: vscode.Uri.file(filePath),
		},
		selection: new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 8)),
	} as vscode.TextEditor;
}

function createWorkspaceService(
	state: ReturnType<typeof createReadyState>,
	workspacePath = 'e:/source/ai-toolkit',
): AnnotationWorkspaceServiceLike {
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


function createReadyState(
	overrides: Partial<Pick<AnnotationStore, 'activeSessionId' | 'sessions'>> & {
		annotations?: AnnotationStore['sessions'][number]['annotations'];
	} = {},
) {
	const store = createStore(overrides);

	return {
		status: 'ready' as const,
		storePath: 'e:/source/ai-toolkit/.vscode/ai-toolkit.annotations.json',
		projection: deriveAnnotationWorkspaceProjection('e:/source/ai-toolkit', store),
	};
}

function createStore(
	overrides: Partial<Pick<AnnotationStore, 'activeSessionId' | 'sessions'>> & {
		annotations?: AnnotationStore['sessions'][number]['annotations'];
	} = {},
): AnnotationStore {
	const annotations = overrides.annotations ?? [
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
	];

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
				annotations,
			},
		],
		...overrides,
	};
}

function createDeferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});

	return { promise, resolve, reject };
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