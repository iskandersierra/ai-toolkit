import * as assert from 'assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	executeAddOrEditAnnotationCommand,
	executeDismissAnnotationCommand,
	executeGenerateDraftOutputCommand,
	executeReanchorAnnotationCommand,
	executeSelectReviewSessionCommand,
	annotationCommandIds,
} from '../../annotations/presentation/annotationCommands';
import { SessionSelectionService } from '../../annotations/application/sessionSelectionService';
import type { AnnotationInputService } from '../../annotations/presentation/annotationInput';
import type {
	AnnotationWorkspaceBlockedResult,
	AnnotationWorkspaceMutationResult,
	AnnotationWorkspaceService,
	AnnotationWorkspaceState,
} from '../../annotations/application/annotationWorkspaceService';
import { deriveAnnotationWorkspaceProjection } from '../../annotations/application/projectionModel';
import { createAnnotationAnchor } from '../../annotations/domain/anchorMatching';
import {
	annotationSelectedTextMaxLength,
	annotationSchemaVersion,
	type AnnotationStore,
} from '../../annotations/domain/annotationModels';

const createdFixtureUris: vscode.Uri[] = [];
let fixtureCounter = 0;

suite('Annotation Commands', () => {
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

	// Scenario: add-or-edit capture prompts for a session when none is active, then saves the new annotation.
	test('creates an annotation after session selection when no session is active', async () => {
		const editor = await openEditor(['before a', 'before b', 'target()', 'after a', 'after b'].join('\n'));
		editor.selection = new vscode.Selection(new vscode.Position(3, 0), new vscode.Position(3, 22));

		const service = new FakeAnnotationWorkspaceService(
			createStore({ activeSessionId: null, sessions: [createSession('session-1', [])] }),
		);
		const selectionService = new SessionSelectionService({
			pickSession: async (items) => items[0],
			promptForNewSessionName: async () => undefined,
		});
		const inputService: AnnotationInputService = {
			promptForAnnotationBody: async () => 'Validate this call path.',
			pickExistingAnnotationAction: async () => 'edit',
			confirmPurgeDismissed: async () => true,
			confirmReanchor: async () => true,
		};

		const result = await executeAddOrEditAnnotationCommand({
			window: createWindowApi(editor),
			getWorkspaceService: async () => service,
			sessionSelectionService: selectionService,
			inputService,
			contextKeys: { refresh: async () => undefined, dispose: () => undefined },
		});

		assert.deepStrictEqual(result, {
			status: 'ready',
			commandId: annotationCommandIds.addOrEditAnnotation,
			workspaceFolder: workspaceFolder().uri.fsPath,
			operation: 'annotationCreated',
			annotationId: 'annotation-new',
			sessionId: undefined,
			purgedCount: undefined,
		});
		assert.strictEqual(service.store.activeSessionId, 'session-1');
		assert.strictEqual(service.store.sessions[0]?.annotations[0]?.body, 'Validate this call path.');
	});

	// Scenario: annotation actions fail clearly when the current editor selection does not resolve to a workspace folder.
	test('blocks add-or-edit outside a workspace folder', async () => {
		const document = await vscode.workspace.openTextDocument({ content: 'draft' });
		const editor = await vscode.window.showTextDocument(document);

		const result = await executeAddOrEditAnnotationCommand({
			window: createWindowApi(editor),
			getWorkspaceService: async () => new FakeAnnotationWorkspaceService(createStore()),
			sessionSelectionService: new SessionSelectionService({
				pickSession: async () => undefined,
				promptForNewSessionName: async () => undefined,
			}),
		});

		assert.deepStrictEqual(result, {
			status: 'blocked',
			commandId: annotationCommandIds.addOrEditAnnotation,
			reason: 'noWorkspaceFolder',
			message: 'AI Toolkit annotations require a saved file inside a workspace folder.',
		});
	});

	// Scenario: invalid canonical store content blocks session selection commands with a clear error path.
	test('blocks session selection when the canonical store is invalid', async () => {
		const editor = await openEditor('target()');
		const blockedService = new FakeAnnotationWorkspaceService(createStore(), {
			state: {
				status: 'invalid',
				storePath: storePath,
				error: new Error('Invalid annotation store.'),
			},
		});

		const result = await executeSelectReviewSessionCommand({
			window: createWindowApi(editor),
			getWorkspaceService: async () => blockedService,
			sessionSelectionService: new SessionSelectionService({
				pickSession: async () => undefined,
				promptForNewSessionName: async () => undefined,
			}),
		});

		assert.deepStrictEqual(result, {
			status: 'blocked',
			commandId: annotationCommandIds.selectReviewSession,
			reason: 'invalidStore',
			message: 'The annotation store is invalid. Fix the store file before running annotation commands.',
			workspaceFolder: workspaceFolder().uri.fsPath,
		});
	});

	// Scenario: draft generation returns a blocked result when the generated document cannot be opened.
	test('blocks draft output when opening the generated document fails', async () => {
		const editor = await openEditor('target()');
		const errorMessages: string[] = [];

		const result = await executeGenerateDraftOutputCommand({
			window: createWindowApi(editor, {
				showErrorMessage: async (message: string) => {
					errorMessages.push(message);
					return undefined;
				},
			}),
			workspace: createWorkspaceApi({
				openTextDocument: async () => {
					throw new Error('open failed');
				},
			}),
			getWorkspaceService: async () => new FakeAnnotationWorkspaceService(createStore()),
			sessionSelectionService: createSessionSelectionService(),
		});

		assert.deepStrictEqual(result, {
			status: 'blocked',
			commandId: annotationCommandIds.generateDraftOutput,
			reason: 'documentOpenFailed',
			message: 'Unable to open the generated draft output document.',
			workspaceFolder: workspaceFolder().uri.fsPath,
		});
		assert.deepStrictEqual(errorMessages, ['Unable to open the generated draft output document.']);
	});

	// Scenario: draft generation returns a blocked result when showing the generated document fails.
	test('blocks draft output when showing the generated document fails', async () => {
		const editor = await openEditor('target()');
		const draftDocument = await vscode.workspace.openTextDocument({ content: 'draft', language: 'markdown' });
		const errorMessages: string[] = [];

		const result = await executeGenerateDraftOutputCommand({
			window: createWindowApi(editor, {
				showErrorMessage: async (message: string) => {
					errorMessages.push(message);
					return undefined;
				},
				showTextDocument: async () => {
					throw new Error('show failed');
				},
			}),
			workspace: createWorkspaceApi({
				openTextDocument: async () => draftDocument,
			}),
			getWorkspaceService: async () => new FakeAnnotationWorkspaceService(createStore()),
			sessionSelectionService: createSessionSelectionService(),
		});

		assert.deepStrictEqual(result, {
			status: 'blocked',
			commandId: annotationCommandIds.generateDraftOutput,
			reason: 'documentOpenFailed',
			message: 'Unable to open the generated draft output document.',
			workspaceFolder: workspaceFolder().uri.fsPath,
		});
		assert.deepStrictEqual(errorMessages, ['Unable to open the generated draft output document.']);
	});

	// Scenario: add-or-edit reports invalid selections distinctly instead of treating them as store failures.
	test('blocks add-or-edit with an invalid selection reason when the selected text exceeds the limit', async () => {
		const oversizedSelectionText = 'a'.repeat(annotationSelectedTextMaxLength + 1);
		const editor = await openEditor(oversizedSelectionText);
		editor.selection = new vscode.Selection(
			new vscode.Position(0, 0),
			new vscode.Position(0, oversizedSelectionText.length),
		);
		const errorMessages: string[] = [];

		const result = await executeAddOrEditAnnotationCommand({
			window: createWindowApi(editor, {
				showErrorMessage: async (message: string) => {
					errorMessages.push(message);
					return undefined;
				},
			}),
			getWorkspaceService: async () => new FakeAnnotationWorkspaceService(createStore()),
			sessionSelectionService: createSessionSelectionService(),
			inputService: {
				promptForAnnotationBody: async () => 'Validate this call path.',
				pickExistingAnnotationAction: async () => 'edit',
				confirmPurgeDismissed: async () => true,
				confirmReanchor: async () => true,
			},
		});

		assert.deepStrictEqual(result, {
			status: 'blocked',
			commandId: annotationCommandIds.addOrEditAnnotation,
			reason: 'invalidSelection',
			message: `Selected text must be at most ${annotationSelectedTextMaxLength} characters.`,
			workspaceFolder: workspaceFolder().uri.fsPath,
		});
		assert.deepStrictEqual(errorMessages, [`Selected text must be at most ${annotationSelectedTextMaxLength} characters.`]);
	});

	// Scenario: existing-annotation reanchor validates the replacement selection before mutating workspace state.
	test('blocks add-or-edit existing-annotation reanchor when the new selection is invalid', async () => {
		const oversizedSelectionText = 'a'.repeat(annotationSelectedTextMaxLength + 1);
		const editor = await openEditor(oversizedSelectionText);
		const filePath = toRelativeEditorPath(editor);
		editor.selection = new vscode.Selection(
			new vscode.Position(0, 0),
			new vscode.Position(0, oversizedSelectionText.length),
		);
		const errorMessages: string[] = [];
		const service = new FakeAnnotationWorkspaceService(
			createStore({
				sessions: [
					createSession('session-1', [createAnnotation('annotation-1', oversizedSelectionText, 0, oversizedSelectionText.length, filePath)]),
				],
			}),
		);

		const result = await executeAddOrEditAnnotationCommand({
			window: createWindowApi(editor, {
				showErrorMessage: async (message: string) => {
					errorMessages.push(message);
					return undefined;
				},
			}),
			getWorkspaceService: async () => service,
			sessionSelectionService: createSessionSelectionService(),
			inputService: {
				promptForAnnotationBody: async () => 'Validate this call path.',
				pickExistingAnnotationAction: async () => 'reanchor',
				confirmPurgeDismissed: async () => true,
				confirmReanchor: async () => true,
			},
		});

		assert.deepStrictEqual(result, {
			status: 'blocked',
			commandId: annotationCommandIds.addOrEditAnnotation,
			reason: 'invalidSelection',
			message: `Selected text must be at most ${annotationSelectedTextMaxLength} characters.`,
			workspaceFolder: workspaceFolder().uri.fsPath,
		});
		assert.deepStrictEqual(errorMessages, [`Selected text must be at most ${annotationSelectedTextMaxLength} characters.`]);
		assert.strictEqual(service.reanchorCalls.length, 0);
	});

	// Scenario: direct reanchor commands report invalid replacement selections without reusing store-failure semantics.
	test('blocks direct reanchor with an invalid selection reason when the selected text exceeds the limit', async () => {
		const oversizedSelectionText = 'a'.repeat(annotationSelectedTextMaxLength + 1);
		const editor = await openEditor(oversizedSelectionText);
		const filePath = toRelativeEditorPath(editor);
		editor.selection = new vscode.Selection(
			new vscode.Position(0, 0),
			new vscode.Position(0, oversizedSelectionText.length),
		);
		const errorMessages: string[] = [];
		const service = new FakeAnnotationWorkspaceService(
			createStore({
				sessions: [
					createSession('session-1', [createAnnotation('annotation-1', oversizedSelectionText, 0, oversizedSelectionText.length, filePath)]),
				],
			}),
		);

		const result = await executeReanchorAnnotationCommand({
			window: createWindowApi(editor, {
				showErrorMessage: async (message: string) => {
					errorMessages.push(message);
					return undefined;
				},
			}),
			getWorkspaceService: async () => service,
			sessionSelectionService: createSessionSelectionService(),
			inputService: {
				promptForAnnotationBody: async () => 'Validate this call path.',
				pickExistingAnnotationAction: async () => 'edit',
				confirmPurgeDismissed: async () => true,
				confirmReanchor: async () => true,
			},
		});

		assert.deepStrictEqual(result, {
			status: 'blocked',
			commandId: annotationCommandIds.reanchorAnnotation,
			reason: 'invalidSelection',
			message: `Selected text must be at most ${annotationSelectedTextMaxLength} characters.`,
			workspaceFolder: workspaceFolder().uri.fsPath,
		});
		assert.deepStrictEqual(errorMessages, [`Selected text must be at most ${annotationSelectedTextMaxLength} characters.`]);
	});

	// Scenario: invalid-store recovery handles Open Store document failures without creating an unhandled rejection.
	test('handles open store recovery failures without rejecting the command', async () => {
		const editor = await openEditor('target()');
		const errorMessages: string[] = [];

		const result = await executeSelectReviewSessionCommand({
			window: createWindowApi(editor, {
				showErrorMessage: (async (message: string, ...items: Array<string | vscode.MessageOptions>) => {
					errorMessages.push(message);
					const actionItems = items.filter((item): item is string => typeof item === 'string');
					return actionItems.includes('Open Store') && errorMessages.length === 1 ? 'Open Store' : undefined;
				}) as typeof vscode.window.showErrorMessage,
			}),
			workspace: createWorkspaceApi({
				openTextDocument: async () => {
					throw new Error('store open failed');
				},
			}),
			getWorkspaceService: async () => new FakeAnnotationWorkspaceService(createStore(), {
				state: {
					status: 'invalid',
					storePath,
					error: new Error('Invalid annotation store.'),
				},
			}),
			sessionSelectionService: createSessionSelectionService(),
		});

		await flushAsyncWork();

		assert.deepStrictEqual(result, {
			status: 'blocked',
			commandId: annotationCommandIds.selectReviewSession,
			reason: 'invalidStore',
			message: 'The annotation store is invalid. Fix the store file before running annotation commands.',
			workspaceFolder: workspaceFolder().uri.fsPath,
		});
		assert.deepStrictEqual(errorMessages, [
			'The annotation store is invalid. Fix the store file before running annotation commands.',
			'Unable to open the annotation store document.',
		]);
	});

		// Scenario: session selection stays successful when post-success context refresh fails.
		test('returns a ready session-selection result when context-key refresh rejects', async () => {
			const editor = await openEditor('target()');

			const result = await executeSelectReviewSessionCommand({
				window: createWindowApi(editor),
				getWorkspaceService: async () => new FakeAnnotationWorkspaceService(createStore()),
				sessionSelectionService: new SessionSelectionService({
					pickSession: async (items) => items[0],
					promptForNewSessionName: async () => undefined,
				}),
				contextKeys: {
					refresh: async () => {
						throw new Error('refresh failed');
					},
					dispose: () => undefined,
				},
			});

			assert.deepStrictEqual(result, {
				status: 'ready',
				commandId: annotationCommandIds.selectReviewSession,
				workspaceFolder: workspaceFolder().uri.fsPath,
				operation: 'reviewSessionSelected',
				sessionId: 'session-1',
			});
		});

	// Scenario: dismiss commands target the selected annotation range and persist the dismissed status.
	test('dismisses the annotation at the current editor selection', async () => {
		const editor = await openEditor('target()');
		const filePath = toRelativeEditorPath(editor);
		editor.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 8));
		const service = new FakeAnnotationWorkspaceService(
			createStore({
				sessions: [createSession('session-1', [createAnnotation('annotation-1', 'target()', 0, 8, filePath)])],
			}),
		);

		const result = await executeDismissAnnotationCommand({
			window: createWindowApi(editor),
			getWorkspaceService: async () => service,
			sessionSelectionService: new SessionSelectionService({
				pickSession: async () => undefined,
				promptForNewSessionName: async () => undefined,
			}),
			contextKeys: { refresh: async () => undefined, dispose: () => undefined },
		});

		assert.deepStrictEqual(result, {
			status: 'ready',
			commandId: annotationCommandIds.dismissAnnotation,
			workspaceFolder: workspaceFolder().uri.fsPath,
			operation: 'annotationDismissed',
			annotationId: 'annotation-1',
			sessionId: undefined,
			purgedCount: undefined,
		});
		assert.strictEqual(service.store.sessions[0]?.annotations[0]?.status, 'dismissed');
	});

	// Scenario: successful mutations stay successful when post-success context refresh fails.
	test('returns a ready dismiss result when context-key refresh rejects', async () => {
		const editor = await openEditor('target()');
		const filePath = toRelativeEditorPath(editor);
		editor.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 8));
		const service = new FakeAnnotationWorkspaceService(
			createStore({
				sessions: [createSession('session-1', [createAnnotation('annotation-1', 'target()', 0, 8, filePath)])],
			}),
		);

		const result = await executeDismissAnnotationCommand({
			window: createWindowApi(editor),
			getWorkspaceService: async () => service,
			sessionSelectionService: createSessionSelectionService(),
			contextKeys: {
				refresh: async () => {
					throw new Error('refresh failed');
				},
				dispose: () => undefined,
			},
		});

		assert.deepStrictEqual(result, {
			status: 'ready',
			commandId: annotationCommandIds.dismissAnnotation,
			workspaceFolder: workspaceFolder().uri.fsPath,
			operation: 'annotationDismissed',
			annotationId: 'annotation-1',
			sessionId: undefined,
			purgedCount: undefined,
		});
		assert.strictEqual(service.store.sessions[0]?.annotations[0]?.status, 'dismissed');
	});
});

const storePath = 'e:/source/ai-toolkit/.vscode/ai-toolkit.annotations.json';

function workspaceFolder(): vscode.WorkspaceFolder {
	return {
		uri: vscode.Uri.file('e:/source/ai-toolkit'),
		index: 0,
		name: 'ai-toolkit',
	};
}

function createWindowApi(
	editor: vscode.TextEditor,
	overrides: Partial<{
		showErrorMessage: typeof vscode.window.showErrorMessage;
		showInformationMessage: typeof vscode.window.showInformationMessage;
		showWarningMessage: typeof vscode.window.showWarningMessage;
		showTextDocument: typeof vscode.window.showTextDocument;
	}> = {},
) {
	return {
		activeTextEditor: editor,
		showErrorMessage: async () => undefined,
		showInformationMessage: async () => undefined,
		showWarningMessage: async () => undefined,
		showTextDocument: vscode.window.showTextDocument.bind(vscode.window),
		...overrides,
	};
}

function createWorkspaceApi(overrides: Partial<Pick<typeof vscode.workspace, 'getConfiguration' | 'openTextDocument'>> = {}) {
	return {
		getConfiguration: vscode.workspace.getConfiguration.bind(vscode.workspace),
		openTextDocument: vscode.workspace.openTextDocument.bind(vscode.workspace),
		...overrides,
	};
	}

function createSessionSelectionService(): SessionSelectionService {
	return new SessionSelectionService({
		pickSession: async () => undefined,
		promptForNewSessionName: async () => undefined,
	});
	}

async function flushAsyncWork(): Promise<void> {
	await new Promise<void>((resolve) => setImmediate(resolve));
	await Promise.resolve();
	}

async function openEditor(content: string): Promise<vscode.TextEditor> {
	const fixtureUri = vscode.Uri.file(
		path.join(workspaceFolder().uri.fsPath, `.annotation-commands-fixture-${fixtureCounter += 1}.ts`),
	);
	createdFixtureUris.push(fixtureUri);
	await vscode.workspace.fs.writeFile(fixtureUri, new TextEncoder().encode(content));
	const document = await vscode.workspace.openTextDocument(fixtureUri);
	return vscode.window.showTextDocument(document);
}

function toRelativeEditorPath(editor: vscode.TextEditor): string {
	return path.relative(workspaceFolder().uri.fsPath, editor.document.uri.fsPath).replace(/\\/g, '/');
}

function createStore(overrides: Partial<AnnotationStore> = {}): AnnotationStore {
	return {
		schemaVersion: annotationSchemaVersion,
		activeSessionId: 'session-1',
		sessions: [createSession('session-1')],
		...overrides,
	};
}

function createSession(sessionId: string, annotations = [createAnnotation('annotation-1')]) {
	return {
		sessionId,
		name: 'Security pass',
		sessionSlug: 'security-pass',
		createdAt: '2026-05-20T10:00:00.000Z',
		updatedAt: '2026-05-20T10:00:00.000Z',
		annotations,
	};
}

function createAnnotation(
	annotationId: string,
	selectedText = 'export function activate',
	startCharacter = 0,
	endCharacter = 22,
	filePath = 'src/extension.ts',
) {
	return {
		annotationId,
		status: 'active' as const,
		anchorState: 'anchored' as const,
		body: 'Validate this call path.',
		filePath,
		createdAt: '2026-05-20T10:05:00.000Z',
		updatedAt: '2026-05-20T10:05:00.000Z',
		anchor: createAnnotationAnchor(
			{
				start: { line: 0, character: startCharacter },
				end: { line: 0, character: endCharacter },
			},
			selectedText,
			['before a', 'before b'],
			['after a', 'after b'],
		),
	};
}

class FakeAnnotationWorkspaceService implements Pick<AnnotationWorkspaceService, 'getState' | 'initialize' | 'createAnnotation' | 'updateAnnotation' | 'dismissAnnotation' | 'reanchorAnnotation' | 'purgeDismissedAnnotations' | 'generateDraftOutput' | 'setActiveSession'> {
	public readonly projection;
	public readonly reanchorCalls: unknown[] = [];

	public constructor(
		public store: AnnotationStore,
		private readonly options: { state?: AnnotationWorkspaceState } = {},
	) {
		this.projection = deriveAnnotationWorkspaceProjection(workspaceFolder().uri.fsPath, store);
	}

	public getState(): AnnotationWorkspaceState {
		return this.options.state ?? { status: 'ready', projection: this.projection, storePath };
	}

	public async initialize(): Promise<AnnotationWorkspaceState> {
		return this.getState();
	}

	public async createSession(name: string): Promise<AnnotationWorkspaceMutationResult> {
		const sessionId = `session-${this.store.sessions.length + 1}`;
		this.store.sessions.push({
			sessionId,
			name,
			sessionSlug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
			createdAt: '2026-05-20T10:00:00.000Z',
			updatedAt: '2026-05-20T10:00:00.000Z',
			annotations: [],
		});
		this.store.activeSessionId = sessionId;
		return {
			status: 'ready',
			projection: deriveAnnotationWorkspaceProjection(workspaceFolder().uri.fsPath, this.store),
			storePath,
			sessionId,
		};
	}

	public async createAnnotation(): Promise<AnnotationWorkspaceMutationResult> {
		this.store.sessions[0]?.annotations.push({
			...createAnnotation('annotation-new'),
			body: 'Validate this call path.',
		});
		return {
			status: 'ready',
			projection: deriveAnnotationWorkspaceProjection(workspaceFolder().uri.fsPath, this.store),
			storePath,
			annotation: deriveAnnotationWorkspaceProjection(workspaceFolder().uri.fsPath, this.store).annotations.find((annotation) => annotation.annotationId === 'annotation-new'),
		};
	}

	public async updateAnnotation(): Promise<AnnotationWorkspaceMutationResult> {
		return {
			status: 'ready',
			projection: deriveAnnotationWorkspaceProjection(workspaceFolder().uri.fsPath, this.store),
			storePath,
			annotation: deriveAnnotationWorkspaceProjection(workspaceFolder().uri.fsPath, this.store).annotations[0],
		};
	}

	public async dismissAnnotation(annotationId: string): Promise<AnnotationWorkspaceMutationResult> {
		const annotation = this.store.sessions[0]?.annotations.find((entry) => entry.annotationId === annotationId);
		if (annotation) {
			annotation.status = 'dismissed';
		}
		const projection = deriveAnnotationWorkspaceProjection(workspaceFolder().uri.fsPath, this.store);
		return {
			status: 'ready',
			projection,
			storePath,
			annotation: projection.annotations.find((entry) => entry.annotationId === annotationId),
		};
	}

	public async reanchorAnnotation(input: unknown): Promise<AnnotationWorkspaceMutationResult> {
		this.reanchorCalls.push(input);
		return {
			status: 'ready',
			projection: deriveAnnotationWorkspaceProjection(workspaceFolder().uri.fsPath, this.store),
			storePath,
			annotation: deriveAnnotationWorkspaceProjection(workspaceFolder().uri.fsPath, this.store).annotations[0],
		};
	}

	public async purgeDismissedAnnotations(): Promise<AnnotationWorkspaceMutationResult> {
		return {
			status: 'ready',
			projection: deriveAnnotationWorkspaceProjection(workspaceFolder().uri.fsPath, this.store),
			storePath,
			purgedCount: 0,
		};
	}

	public async generateDraftOutput(): Promise<AnnotationWorkspaceMutationResult> {
		return {
			status: 'ready',
			projection: deriveAnnotationWorkspaceProjection(workspaceFolder().uri.fsPath, this.store),
			storePath,
		};
	}

	public async setActiveSession(sessionId: string): Promise<AnnotationWorkspaceMutationResult> {
		this.store.activeSessionId = sessionId;
		return {
			status: 'ready',
			projection: deriveAnnotationWorkspaceProjection(workspaceFolder().uri.fsPath, this.store),
			storePath,
			sessionId,
		};
	}
}