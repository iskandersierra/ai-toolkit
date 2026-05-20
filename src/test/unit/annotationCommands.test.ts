import * as assert from 'assert';
import * as vscode from 'vscode';
import {
	executeAddOrEditAnnotationCommand,
	executeDismissAnnotationCommand,
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
	annotationSchemaVersion,
	type AnnotationStore,
} from '../../annotations/domain/annotationModels';

suite('Annotation Commands', () => {
	// Scenario: add-or-edit capture prompts for a session when none is active, then saves the new annotation.
	test('creates an annotation after session selection when no session is active', async () => {
		const editor = await openEditor(['before a', 'before b', 'target()', 'after a', 'after b'].join('\n'));
		editor.selection = new vscode.Selection(new vscode.Position(2, 0), new vscode.Position(2, 8));

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
			contextKeys: { refresh: async () => undefined },
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

	// Scenario: dismiss commands target the selected annotation range and persist the dismissed status.
	test('dismisses the annotation at the current editor selection', async () => {
		const editor = await openEditor(['before a', 'before b', 'target()', 'after a', 'after b'].join('\n'));
		editor.selection = new vscode.Selection(new vscode.Position(2, 0), new vscode.Position(2, 8));
		const service = new FakeAnnotationWorkspaceService(createStore());

		const result = await executeDismissAnnotationCommand({
			window: createWindowApi(editor),
			getWorkspaceService: async () => service,
			sessionSelectionService: new SessionSelectionService({
				pickSession: async () => undefined,
				promptForNewSessionName: async () => undefined,
			}),
			contextKeys: { refresh: async () => undefined },
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

function createWindowApi(editor: vscode.TextEditor) {
	return {
		activeTextEditor: editor,
		showErrorMessage: async () => undefined,
		showInformationMessage: async () => undefined,
		showWarningMessage: async () => undefined,
	};
}

async function openEditor(content: string): Promise<vscode.TextEditor> {
	const document = await vscode.workspace.openTextDocument({
		language: 'typescript',
		content,
	});
	return vscode.window.showTextDocument(document);
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

function createAnnotation(annotationId: string) {
	return {
		annotationId,
		status: 'active' as const,
		anchorState: 'anchored' as const,
		body: 'Validate this call path.',
		filePath: 'src/extension.ts',
		createdAt: '2026-05-20T10:05:00.000Z',
		updatedAt: '2026-05-20T10:05:00.000Z',
		anchor: createAnnotationAnchor(
			{
				start: { line: 2, character: 0 },
				end: { line: 2, character: 8 },
			},
			'target()',
			['before a', 'before b'],
			['after a', 'after b'],
		),
	};
}

class FakeAnnotationWorkspaceService implements Pick<AnnotationWorkspaceService, 'getState' | 'initialize' | 'createAnnotation' | 'updateAnnotation' | 'dismissAnnotation' | 'reanchorAnnotation' | 'purgeDismissedAnnotations' | 'generateDraftOutput' | 'setActiveSession'> {
	public readonly projection;

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

	public async reanchorAnnotation(): Promise<AnnotationWorkspaceMutationResult> {
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
			stub: 'draftOutput',
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