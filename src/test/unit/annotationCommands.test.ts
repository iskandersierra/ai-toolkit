import * as assert from 'assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	executeAddOrEditAnnotationCommand,
	executeClearReviewSessionAnnotationsCommand,
	executeDeleteReviewSessionCommand,
	executeDismissAnnotationCommand,
	executeGenerateDraftOutputCommand,
	executeReanchorAnnotationCommand,
	executeReopenAnnotationCommand,
	executeResolveAnnotationCommand,
	executeSelectReviewSessionCommand,
	annotationCommandIds,
} from '../../annotations/presentation/annotationCommands';
import { SessionSelectionService } from '../../annotations/application/sessionSelectionService';
import type { AnnotationInputService, ExistingAnnotationAction } from '../../annotations/presentation/annotationInput';
import type {
	AnnotationWorkspaceBlockedResult,
	AnnotationWorkspaceMutationResult,
	AnnotationWorkspaceService,
	AnnotationWorkspaceState,
} from '../../annotations/application/annotationWorkspaceService';
import { deriveAnnotationWorkspaceProjection } from '../../annotations/application/projectionModel';
import { createAnnotationAnchor } from '../../annotations/domain/anchorMatching';
import { createSessionMaintenanceQuickPickItems } from '../../annotations/presentation/sessionMaintenanceQuickPick';
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
		const callOrder: string[] = [];

		const service = new FakeAnnotationWorkspaceService(
			createStore({ activeSessionId: null, sessions: [createSession('session-1', [])] }),
		);
		const selectionService = new SessionSelectionService({
			pickSession: async (items) => {
				callOrder.push('pickSession');
				return items[0];
			},
			promptForNewSessionName: async () => undefined,
		});
		const inputService: AnnotationInputService = {
			promptForAnnotationBody: async () => {
				callOrder.push('promptForAnnotationBody');
				return 'Validate this call path.';
			},
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
		assert.deepStrictEqual(callOrder, ['pickSession', 'promptForAnnotationBody']);
	});

	// Scenario: Given zero review sessions, When add-or-edit runs, Then it auto-creates Review Session before prompting for the annotation body.
	test('creates an annotation after auto-creating the first review session', async () => {
		const editor = await openEditor(['before a', 'before b', 'target()', 'after a', 'after b'].join('\n'));
		editor.selection = new vscode.Selection(new vscode.Position(3, 0), new vscode.Position(3, 22));
		const callOrder: string[] = [];
		let pickSessionCount = 0;
		let promptForSessionNameCount = 0;

		const service = new FakeAnnotationWorkspaceService(createStore({ activeSessionId: null, sessions: [] }));
		const selectionService = new SessionSelectionService({
			pickSession: async () => {
				pickSessionCount += 1;
				callOrder.push('pickSession');
				return undefined;
			},
			promptForNewSessionName: async () => {
				promptForSessionNameCount += 1;
				callOrder.push('promptForNewSessionName');
				return undefined;
			},
		});
		const inputService: AnnotationInputService = {
			promptForAnnotationBody: async () => {
				callOrder.push('promptForAnnotationBody');
				return 'Validate this call path.';
			},
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
		assert.strictEqual(service.store.sessions.length, 1);
		assert.strictEqual(service.store.sessions[0]?.name, 'Review Session');
		assert.strictEqual(service.store.activeSessionId, 'session-1');
		assert.strictEqual(service.store.sessions[0]?.annotations[0]?.body, 'Validate this call path.');
		assert.strictEqual(pickSessionCount, 0);
		assert.strictEqual(promptForSessionNameCount, 0);
		assert.deepStrictEqual(callOrder, ['promptForAnnotationBody']);
	});

	// Scenario: Given an empty selection with no annotation target, When add-or-edit runs, Then it blocks before prompting for the annotation body.
	test('blocks empty untargeted selections before prompting for the annotation body', async () => {
		const editor = await openEditor('target()');
		editor.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0));
		let promptCount = 0;

		const result = await executeAddOrEditAnnotationCommand({
			window: createWindowApi(editor),
			getWorkspaceService: async () => new FakeAnnotationWorkspaceService(createStore()),
			sessionSelectionService: createSessionSelectionService(),
			inputService: {
				promptForAnnotationBody: async () => {
					promptCount += 1;
					return 'should not be used';
				},
				pickExistingAnnotationAction: async () => 'edit',
				confirmPurgeDismissed: async () => true,
				confirmReanchor: async () => true,
			},
		});

		assert.deepStrictEqual(result, {
			status: 'blocked',
			commandId: annotationCommandIds.addOrEditAnnotation,
			reason: 'noEditorSelection',
			message: 'Select code or place the cursor on an existing annotated range.',
			workspaceFolder: workspaceFolder().uri.fsPath,
		});
		assert.strictEqual(promptCount, 0);
	});

	// Scenario: Given a forward selection spanning more than 50 lines, When add-or-edit runs, Then it blocks before prompting for the annotation body.
	test('blocks oversized forward selections before prompting for the annotation body', async () => {
		const editor = await openEditor(Array.from({ length: 52 }, (_, index) => `line ${index}`).join('\n'));
		editor.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(51, 6));
		let promptCount = 0;

		const result = await executeAddOrEditAnnotationCommand({
			window: createWindowApi(editor),
			getWorkspaceService: async () => new FakeAnnotationWorkspaceService(
				createStore({ sessions: [createSession('session-1', [])] }),
			),
			sessionSelectionService: createSessionSelectionService(),
			inputService: {
				promptForAnnotationBody: async () => {
					promptCount += 1;
					return 'should not be used';
				},
				pickExistingAnnotationAction: async () => 'edit',
				confirmPurgeDismissed: async () => true,
				confirmReanchor: async () => true,
			},
		});

		assert.deepStrictEqual(result, {
			status: 'blocked',
			commandId: annotationCommandIds.addOrEditAnnotation,
			reason: 'invalidSelection',
			message: 'Select 50 lines or fewer before creating or reanchoring an annotation.',
			workspaceFolder: workspaceFolder().uri.fsPath,
		});
		assert.strictEqual(promptCount, 0);
	});

	// Scenario: Given a reversed selection spanning more than 50 lines, When add-or-edit runs, Then it blocks before prompting for the annotation body.
	test('blocks oversized reversed selections before prompting for the annotation body', async () => {
		const editor = await openEditor(Array.from({ length: 52 }, (_, index) => `line ${index}`).join('\n'));
		editor.selection = new vscode.Selection(new vscode.Position(51, 6), new vscode.Position(0, 0));
		let promptCount = 0;

		const result = await executeAddOrEditAnnotationCommand({
			window: createWindowApi(editor),
			getWorkspaceService: async () => new FakeAnnotationWorkspaceService(
				createStore({ sessions: [createSession('session-1', [])] }),
			),
			sessionSelectionService: createSessionSelectionService(),
			inputService: {
				promptForAnnotationBody: async () => {
					promptCount += 1;
					return 'should not be used';
				},
				pickExistingAnnotationAction: async () => 'edit',
				confirmPurgeDismissed: async () => true,
				confirmReanchor: async () => true,
			},
		});

		assert.deepStrictEqual(result, {
			status: 'blocked',
			commandId: annotationCommandIds.addOrEditAnnotation,
			reason: 'invalidSelection',
			message: 'Select 50 lines or fewer before creating or reanchoring an annotation.',
			workspaceFolder: workspaceFolder().uri.fsPath,
		});
		assert.strictEqual(promptCount, 0);
	});

	// Scenario: Given a 51-line selection ending at column 0, When add-or-edit runs, Then the trailing line is excluded and annotation capture proceeds.
	test('allows the trailing-column-0 selection exception at the 50-line limit', async () => {
		const editor = await openEditor(Array.from({ length: 51 }, (_, index) => `line ${index}`).join('\n'));
		editor.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(50, 0));
		let promptCount = 0;

		const result = await executeAddOrEditAnnotationCommand({
			window: createWindowApi(editor),
			getWorkspaceService: async () => new FakeAnnotationWorkspaceService(
				createStore({ sessions: [createSession('session-1', [])] }),
			),
			sessionSelectionService: createSessionSelectionService(),
			inputService: {
				promptForAnnotationBody: async () => {
					promptCount += 1;
					return 'Validate this call path.';
				},
				pickExistingAnnotationAction: async () => 'edit',
				confirmPurgeDismissed: async () => true,
				confirmReanchor: async () => true,
			},
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
		assert.strictEqual(promptCount, 1);
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

	// Scenario: Given zero review sessions, When the explicit select review session command runs, Then it auto-creates and activates Review Session without opening the picker.
	test('auto-creates the first review session for the explicit select review session command', async () => {
		const editor = await openEditor('target()');
		const informationMessages: string[] = [];
		let pickSessionCount = 0;
		let promptForSessionNameCount = 0;
		const service = new FakeAnnotationWorkspaceService(createStore({ activeSessionId: null, sessions: [] }));

		const result = await executeSelectReviewSessionCommand({
			window: createWindowApi(editor, {
				showInformationMessage: async (message: string) => {
					informationMessages.push(message);
					return undefined;
				},
			}),
			getWorkspaceService: async () => service,
			sessionSelectionService: new SessionSelectionService({
				pickSession: async () => {
					pickSessionCount += 1;
					return undefined;
				},
				promptForNewSessionName: async () => {
					promptForSessionNameCount += 1;
					return undefined;
				},
			}),
			contextKeys: { refresh: async () => undefined, dispose: () => undefined },
		});

		assert.deepStrictEqual(result, {
			status: 'ready',
			commandId: annotationCommandIds.selectReviewSession,
			workspaceFolder: workspaceFolder().uri.fsPath,
			operation: 'reviewSessionSelected',
			sessionId: 'session-1',
		});
		assert.strictEqual(service.store.sessions.length, 1);
		assert.strictEqual(service.store.sessions[0]?.name, 'Review Session');
		assert.strictEqual(service.store.activeSessionId, 'session-1');
		assert.strictEqual(pickSessionCount, 0);
		assert.strictEqual(promptForSessionNameCount, 0);
		assert.deepStrictEqual(informationMessages, ['Created and activated the review session.']);
	});

	// Scenario: Given sessions with different updatedAt values, When maintenance picker items are created, Then they are ordered by most recent update and mark the active session.
	test('orders maintenance picker items by updatedAt descending and marks the active session', () => {
		const items = createSessionMaintenanceQuickPickItems(
			deriveAnnotationWorkspaceProjection(workspaceFolder().uri.fsPath, createStore({
				activeSessionId: 'session-2',
				sessions: [
					createSession('session-1', [], 'Older session', '2026-05-20T10:00:00.000Z'),
					createSession('session-2', [], 'Newest session', '2026-05-20T12:00:00.000Z'),
					createSession('session-3', [], 'Middle session', '2026-05-20T11:00:00.000Z'),
				],
			})).sessions,
		);

		assert.deepStrictEqual(items.map((item) => item.sessionId), ['session-2', 'session-3', 'session-1']);
		assert.strictEqual(items[0]?.description, 'Active session');
		assert.strictEqual(items[0]?.annotationCount, 0);
	});

	// Scenario: Given a selected review session, When delete review session runs, Then it confirms destructively and deletes the chosen session.
	test('deletes the selected review session through picker and confirmation orchestration', async () => {
		const editor = await openEditor('target()');
		const service = new FakeAnnotationWorkspaceService(createStore({
			activeSessionId: 'session-1',
			sessions: [
				createSession('session-1', [createAnnotation('annotation-1')], 'Security pass'),
				createSession('session-2', [createAnnotation('annotation-2')], 'Review Session 2'),
			],
		}));
		const pickedSessions: string[] = [];
		const confirmationCalls: Array<{ name: string; count: number; isActive: boolean }> = [];

		const result = await executeDeleteReviewSessionCommand({
			window: createWindowApi(editor),
			getWorkspaceService: async () => service,
			sessionSelectionService: createSessionSelectionService(),
			sessionMaintenancePresenter: {
				pickSession: async (_operation, items) => {
					pickedSessions.push(...items.map((item) => item.sessionId));
					return items.find((item) => item.sessionId === 'session-2');
				},
			},
			inputService: {
				promptForAnnotationBody: async () => 'body',
				pickExistingAnnotationAction: async () => 'edit',
				confirmPurgeDismissed: async () => true,
				confirmReanchor: async () => true,
				confirmDeleteSession: async (sessionName, annotationCount, isActiveSession) => {
					confirmationCalls.push({ name: sessionName, count: annotationCount, isActive: isActiveSession });
					return true;
				},
			},
			contextKeys: { refresh: async () => undefined, dispose: () => undefined },
		});

		assert.deepStrictEqual(result, {
			status: 'ready',
			commandId: annotationCommandIds.deleteReviewSession,
			workspaceFolder: workspaceFolder().uri.fsPath,
			operation: 'reviewSessionDeleted',
			annotationId: undefined,
			sessionId: 'session-1',
			purgedCount: undefined,
		});
		assert.deepStrictEqual(pickedSessions, ['session-1', 'session-2']);
		assert.deepStrictEqual(confirmationCalls, [{ name: 'Review Session 2', count: 1, isActive: false }]);
		assert.deepStrictEqual(service.store.sessions.map((session) => session.sessionId), ['session-1']);
	});

	// Scenario: Given a populated review session, When clear review session annotations runs, Then it confirms destructively and clears only that session.
	test('clears the selected review session annotations through picker and confirmation orchestration', async () => {
		const editor = await openEditor('target()');
		const service = new FakeAnnotationWorkspaceService(createStore({
			activeSessionId: 'session-1',
			sessions: [
				createSession('session-1', [createAnnotation('annotation-1')], 'Security pass'),
				createSession('session-2', [createAnnotation('annotation-2')], 'Review Session 2'),
			],
		}));
		const confirmationCalls: Array<{ name: string; count: number }> = [];

		const result = await executeClearReviewSessionAnnotationsCommand({
			window: createWindowApi(editor),
			getWorkspaceService: async () => service,
			sessionSelectionService: createSessionSelectionService(),
			sessionMaintenancePresenter: {
				pickSession: async (_operation, items) => items.find((item) => item.sessionId === 'session-2'),
			},
			inputService: {
				promptForAnnotationBody: async () => 'body',
				pickExistingAnnotationAction: async () => 'edit',
				confirmPurgeDismissed: async () => true,
				confirmReanchor: async () => true,
				confirmClearSessionAnnotations: async (sessionName, annotationCount) => {
					confirmationCalls.push({ name: sessionName, count: annotationCount });
					return true;
				},
			},
			contextKeys: { refresh: async () => undefined, dispose: () => undefined },
		});

		assert.deepStrictEqual(result, {
			status: 'ready',
			commandId: annotationCommandIds.clearReviewSessionAnnotations,
			workspaceFolder: workspaceFolder().uri.fsPath,
			operation: 'reviewSessionAnnotationsCleared',
			annotationId: undefined,
			sessionId: 'session-2',
			purgedCount: undefined,
		});
		assert.deepStrictEqual(confirmationCalls, [{ name: 'Review Session 2', count: 1 }]);
		assert.deepStrictEqual(service.store.sessions[0]?.annotations.map((annotation) => annotation.annotationId), ['annotation-1']);
		assert.deepStrictEqual(service.store.sessions[1]?.annotations, []);
	});

	// Scenario: Given an unknown picked review session, When delete or clear runs, Then the command returns the blocked unknown-session result from the service.
	test('surfaces unknown-session blocked results for delete and clear maintenance commands', async () => {
		const editor = await openEditor('target()');
		const service = new FakeAnnotationWorkspaceService(createStore());
		service.deletedSessionIds.add('missing-session');
		service.clearedSessionIds.add('missing-session');

		const deleteResult = await executeDeleteReviewSessionCommand({
			window: createWindowApi(editor),
			getWorkspaceService: async () => service,
			sessionSelectionService: createSessionSelectionService(),
			sessionMaintenancePresenter: {
				pickSession: async () => ({
					type: 'session',
					sessionId: 'missing-session',
					label: 'Missing',
					isActive: false,
					detail: '0 annotations, 0 dismissed, updated 2026-05-20T10:00:00.000Z',
					annotationCount: 0,
					updatedAt: '2026-05-20T10:00:00.000Z',
				}),
			},
			inputService: {
				promptForAnnotationBody: async () => 'body',
				pickExistingAnnotationAction: async () => 'edit',
				confirmPurgeDismissed: async () => true,
				confirmReanchor: async () => true,
				confirmDeleteSession: async () => true,
				confirmClearSessionAnnotations: async () => true,
			},
		});

		const clearResult = await executeClearReviewSessionAnnotationsCommand({
			window: createWindowApi(editor),
			getWorkspaceService: async () => service,
			sessionSelectionService: createSessionSelectionService(),
			sessionMaintenancePresenter: {
				pickSession: async () => ({
					type: 'session',
					sessionId: 'missing-session',
					label: 'Missing',
					isActive: false,
					detail: '0 annotations, 0 dismissed, updated 2026-05-20T10:00:00.000Z',
					annotationCount: 0,
					updatedAt: '2026-05-20T10:00:00.000Z',
				}),
			},
			inputService: {
				promptForAnnotationBody: async () => 'body',
				pickExistingAnnotationAction: async () => 'edit',
				confirmPurgeDismissed: async () => true,
				confirmReanchor: async () => true,
				confirmDeleteSession: async () => true,
				confirmClearSessionAnnotations: async () => true,
			},
		});

		assert.deepStrictEqual(deleteResult, {
			status: 'blocked',
			commandId: annotationCommandIds.deleteReviewSession,
			reason: 'sessionNotFound',
			message: 'The selected review session could not be found.',
			workspaceFolder: workspaceFolder().uri.fsPath,
		});
		assert.deepStrictEqual(clearResult, {
			status: 'blocked',
			commandId: annotationCommandIds.clearReviewSessionAnnotations,
			reason: 'sessionNotFound',
			message: 'The selected review session could not be found.',
			workspaceFolder: workspaceFolder().uri.fsPath,
		});
	});

	// Scenario: Given no review sessions, When delete or clear review session runs, Then each command returns a clear informational result instead of generic cancellation.
	test('reports an informational no-session result for delete and clear review session commands', async () => {
		const editor = await openEditor('target()');
		const informationMessages: string[] = [];
		let pickCount = 0;

		const deleteResult = await executeDeleteReviewSessionCommand({
			window: createWindowApi(editor, {
				showInformationMessage: async (message: string) => {
					informationMessages.push(message);
					return undefined;
				},
			}),
			getWorkspaceService: async () => new FakeAnnotationWorkspaceService(createStore({ activeSessionId: null, sessions: [] })),
			sessionSelectionService: createSessionSelectionService(),
			sessionMaintenancePresenter: {
				pickSession: async () => {
					pickCount += 1;
					return undefined;
				},
			},
		});

		const clearResult = await executeClearReviewSessionAnnotationsCommand({
			window: createWindowApi(editor, {
				showInformationMessage: async (message: string) => {
					informationMessages.push(message);
					return undefined;
				},
			}),
			getWorkspaceService: async () => new FakeAnnotationWorkspaceService(createStore({ activeSessionId: null, sessions: [] })),
			sessionSelectionService: createSessionSelectionService(),
			sessionMaintenancePresenter: {
				pickSession: async () => {
					pickCount += 1;
					return undefined;
				},
			},
		});

		assert.deepStrictEqual(deleteResult, {
			status: 'blocked',
			commandId: annotationCommandIds.deleteReviewSession,
			reason: 'noReviewSessions',
			message: 'There are no review sessions to delete.',
			workspaceFolder: workspaceFolder().uri.fsPath,
		});
		assert.deepStrictEqual(clearResult, {
			status: 'blocked',
			commandId: annotationCommandIds.clearReviewSessionAnnotations,
			reason: 'noReviewSessions',
			message: 'There are no review sessions to clear.',
			workspaceFolder: workspaceFolder().uri.fsPath,
		});
		assert.deepStrictEqual(informationMessages, [
			'There are no review sessions to delete.',
			'There are no review sessions to clear.',
		]);
		assert.strictEqual(pickCount, 0);
	});

	// Scenario: Given the active review session is being deleted, When the built-in confirmation runs, Then the modal text includes the session name, annotation count, and active-session warning.
	test('includes the active-session warning in delete confirmation messaging', async () => {
		const editor = await openEditor('target()');
		const confirmationCalls: Array<{ name: string; count: number; isActive: boolean }> = [];

		const result = await executeDeleteReviewSessionCommand({
			window: createWindowApi(editor),
			getWorkspaceService: async () => new FakeAnnotationWorkspaceService(createStore({
				activeSessionId: 'session-1',
				sessions: [
					createSession('session-1', [createAnnotation('annotation-1')], 'Security pass', '2026-05-20T10:00:00.000Z'),
					createSession('session-2', [createAnnotation('annotation-2')], 'Review Session 2', '2026-05-20T12:00:00.000Z'),
				],
			})),
			sessionSelectionService: createSessionSelectionService(),
			sessionMaintenancePresenter: {
				pickSession: async (_operation, items) => items.find((item) => item.sessionId === 'session-1'),
			},
			inputService: {
				promptForAnnotationBody: async () => 'body',
				pickExistingAnnotationAction: async () => 'edit',
				confirmPurgeDismissed: async () => true,
				confirmReanchor: async () => true,
				confirmDeleteSession: async (sessionName, annotationCount, isActiveSession) => {
					confirmationCalls.push({ name: sessionName, count: annotationCount, isActive: isActiveSession });
					return true;
				},
			},
			contextKeys: { refresh: async () => undefined, dispose: () => undefined },
		});

		assert.deepStrictEqual(result, {
			status: 'ready',
			commandId: annotationCommandIds.deleteReviewSession,
			workspaceFolder: workspaceFolder().uri.fsPath,
			operation: 'reviewSessionDeleted',
			annotationId: undefined,
			sessionId: 'session-2',
			purgedCount: undefined,
		});
		assert.deepStrictEqual(confirmationCalls, [{ name: 'Security pass', count: 1, isActive: true }]);
	});

	// Scenario: Given the active review session is deleted and another becomes active, When delete review session succeeds, Then the success message names both the deleted and new active sessions.
	test('reports the deleted and reassigned active session names after deleting the active review session', async () => {
		const editor = await openEditor('target()');
		const informationMessages: string[] = [];

		const result = await executeDeleteReviewSessionCommand({
			window: createWindowApi(editor, {
				showInformationMessage: async (message: string) => {
					informationMessages.push(message);
					return undefined;
				},
			}),
			getWorkspaceService: async () => new FakeAnnotationWorkspaceService(createStore({
				activeSessionId: 'session-1',
				sessions: [
					createSession('session-1', [createAnnotation('annotation-1')], 'Security pass', '2026-05-20T10:00:00.000Z'),
					createSession('session-2', [createAnnotation('annotation-2')], 'Review Session 2', '2026-05-20T12:00:00.000Z'),
				],
			})),
			sessionSelectionService: createSessionSelectionService(),
			sessionMaintenancePresenter: {
				pickSession: async (_operation, items) => items.find((item) => item.sessionId === 'session-1'),
			},
			inputService: {
				promptForAnnotationBody: async () => 'body',
				pickExistingAnnotationAction: async () => 'edit',
				confirmPurgeDismissed: async () => true,
				confirmReanchor: async () => true,
				confirmDeleteSession: async () => true,
			},
			contextKeys: { refresh: async () => undefined, dispose: () => undefined },
		});

		assert.deepStrictEqual(result, {
			status: 'ready',
			commandId: annotationCommandIds.deleteReviewSession,
			workspaceFolder: workspaceFolder().uri.fsPath,
			operation: 'reviewSessionDeleted',
			annotationId: undefined,
			sessionId: 'session-2',
			purgedCount: undefined,
		});
		assert.deepStrictEqual(informationMessages, [
			'Deleted review session "Security pass". Active review session is now "Review Session 2".',
		]);
	});

	// Scenario: Given a populated review session, When clear review session annotations succeeds, Then the success message names the session and the number of annotations removed.
	test('reports the cleared session name and removed annotation count after clearing annotations', async () => {
		const editor = await openEditor('target()');
		const informationMessages: string[] = [];

		const result = await executeClearReviewSessionAnnotationsCommand({
			window: createWindowApi(editor, {
				showInformationMessage: async (message: string) => {
					informationMessages.push(message);
					return undefined;
				},
			}),
			getWorkspaceService: async () => new FakeAnnotationWorkspaceService(createStore({
				activeSessionId: 'session-1',
				sessions: [
					createSession('session-1', [createAnnotation('annotation-1')], 'Security pass'),
					createSession('session-2', [createAnnotation('annotation-2'), createAnnotation('annotation-3')], 'Review Session 2'),
				],
			})),
			sessionSelectionService: createSessionSelectionService(),
			sessionMaintenancePresenter: {
				pickSession: async (_operation, items) => items.find((item) => item.sessionId === 'session-2'),
			},
			inputService: {
				promptForAnnotationBody: async () => 'body',
				pickExistingAnnotationAction: async () => 'edit',
				confirmPurgeDismissed: async () => true,
				confirmReanchor: async () => true,
				confirmClearSessionAnnotations: async () => true,
			},
			contextKeys: { refresh: async () => undefined, dispose: () => undefined },
		});

		assert.deepStrictEqual(result, {
			status: 'ready',
			commandId: annotationCommandIds.clearReviewSessionAnnotations,
			workspaceFolder: workspaceFolder().uri.fsPath,
			operation: 'reviewSessionAnnotationsCleared',
			annotationId: undefined,
			sessionId: 'session-2',
			purgedCount: undefined,
		});
		assert.deepStrictEqual(informationMessages, [
			'Cleared 2 annotations from review session "Review Session 2".',
		]);
	});

	// Scenario: Given an oversized existing-annotation selection, When add-or-edit runs, Then the quick pick omits the reanchor action before the user selects an operation.
	test('omits reanchor from existing annotation actions when the current selection exceeds the 50-line limit', async () => {
		const editor = await openEditor(Array.from({ length: 52 }, (_, index) => `line ${index}`).join('\n'));
		const filePath = toRelativeEditorPath(editor);
		editor.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(51, 6));
		const service = new FakeAnnotationWorkspaceService(
			createStore({
				sessions: [
					createSession('session-1', [createAnnotation('annotation-1', editor.document.getText(), 0, 6, filePath)]),
				],
			}),
		);
		let capturedAvailableActions: ExistingAnnotationAction[] | undefined;

		await executeAddOrEditAnnotationCommand({
			window: createWindowApi(editor),
			getWorkspaceService: async () => service,
			sessionSelectionService: createSessionSelectionService(),
			inputService: {
				promptForAnnotationBody: async () => 'body',
				pickExistingAnnotationAction: async (_annotation, availableActions) => {
					capturedAvailableActions = availableActions;
					return 'edit';
				},
				confirmPurgeDismissed: async () => true,
				confirmReanchor: async () => true,
			},
		});

		assert.ok(capturedAvailableActions !== undefined, 'Expected pickExistingAnnotationAction to be called');
		assert.ok(!capturedAvailableActions.includes('reanchor'));
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

	// Scenario: Given selectedText longer than the legacy 2000-char limit, When add-or-edit runs, Then per-line normalization truncates it and the annotation is created.
	test('accepts oversized single-line selected text in add-or-edit after per-line normalization', async () => {
		const oversizedSelectionText = 'a'.repeat(annotationSelectedTextMaxLength + 1);
		const editor = await openEditor(oversizedSelectionText);
		editor.selection = new vscode.Selection(
			new vscode.Position(0, 0),
			new vscode.Position(0, oversizedSelectionText.length),
		);

		const result = await executeAddOrEditAnnotationCommand({
			window: createWindowApi(editor),
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
			status: 'ready',
			commandId: annotationCommandIds.addOrEditAnnotation,
			workspaceFolder: workspaceFolder().uri.fsPath,
			operation: 'annotationCreated',
			annotationId: 'annotation-new',
			sessionId: undefined,
			purgedCount: undefined,
		});
	});

	// Scenario: Given selectedText longer than the legacy limit, When existing-annotation reanchor runs, Then per-line normalization truncates it and the annotation is reanchored.
	test('accepts oversized single-line selected text for existing-annotation reanchor after per-line normalization', async () => {
		const oversizedSelectionText = 'a'.repeat(annotationSelectedTextMaxLength + 1);
		const editor = await openEditor(oversizedSelectionText);
		const filePath = toRelativeEditorPath(editor);
		editor.selection = new vscode.Selection(
			new vscode.Position(0, 0),
			new vscode.Position(0, oversizedSelectionText.length),
		);
		const service = new FakeAnnotationWorkspaceService(
			createStore({
				sessions: [
					createSession('session-1', [createAnnotation('annotation-1', oversizedSelectionText, 0, oversizedSelectionText.length, filePath)]),
				],
			}),
		);

		const result = await executeAddOrEditAnnotationCommand({
			window: createWindowApi(editor),
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
			status: 'ready',
			commandId: annotationCommandIds.addOrEditAnnotation,
			workspaceFolder: workspaceFolder().uri.fsPath,
			operation: 'annotationReanchored',
			annotationId: 'annotation-1',
			sessionId: undefined,
			purgedCount: undefined,
		});
	});

	// Scenario: Given selectedText longer than the legacy limit, When direct reanchor runs, Then per-line normalization truncates it and the annotation is reanchored.
	test('accepts oversized single-line selected text in direct reanchor after per-line normalization', async () => {
		const oversizedSelectionText = 'a'.repeat(annotationSelectedTextMaxLength + 1);
		const editor = await openEditor(oversizedSelectionText);
		const filePath = toRelativeEditorPath(editor);
		editor.selection = new vscode.Selection(
			new vscode.Position(0, 0),
			new vscode.Position(0, oversizedSelectionText.length),
		);
		const service = new FakeAnnotationWorkspaceService(
			createStore({
				sessions: [
					createSession('session-1', [createAnnotation('annotation-1', oversizedSelectionText, 0, oversizedSelectionText.length, filePath)]),
				],
			}),
		);

		const result = await executeReanchorAnnotationCommand({
			window: createWindowApi(editor),
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
			status: 'ready',
			commandId: annotationCommandIds.reanchorAnnotation,
			workspaceFolder: workspaceFolder().uri.fsPath,
			operation: 'annotationReanchored',
			annotationId: 'annotation-1',
			sessionId: undefined,
			purgedCount: undefined,
		});
	});

	// Scenario: Given a direct reanchor selection spanning more than 50 lines, When reanchor runs, Then it blocks before confirmation and service mutation.
	test('blocks oversized selections before direct reanchor confirmation and mutation', async () => {
		const editor = await openEditor(Array.from({ length: 52 }, (_, index) => `line ${index}`).join('\n'));
		const filePath = toRelativeEditorPath(editor);
		editor.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(51, 6));
		const service = new FakeAnnotationWorkspaceService(
			createStore({
				sessions: [
					createSession('session-1', [createAnnotation('annotation-1', 'line 0', 0, 6, filePath)]),
				],
			}),
		);
		let confirmCount = 0;

		const result = await executeReanchorAnnotationCommand({
			window: createWindowApi(editor),
			getWorkspaceService: async () => service,
			sessionSelectionService: createSessionSelectionService(),
			inputService: {
				promptForAnnotationBody: async () => 'Validate this call path.',
				pickExistingAnnotationAction: async () => 'edit',
				confirmPurgeDismissed: async () => true,
				confirmReanchor: async () => {
					confirmCount += 1;
					return true;
				},
			},
		}, { annotationId: 'annotation-1' });

		assert.deepStrictEqual(result, {
			status: 'blocked',
			commandId: annotationCommandIds.reanchorAnnotation,
			reason: 'invalidSelection',
			message: 'Select 50 lines or fewer before creating or reanchoring an annotation.',
			workspaceFolder: workspaceFolder().uri.fsPath,
		});
		assert.strictEqual(confirmCount, 0);
		assert.strictEqual(service.reanchorCalls.length, 0);
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

		// Scenario: Given a clicked annotation comment thread, When dismiss runs from the comments surface, Then the mapped annotation is dismissed without relying on the active editor selection.
		test('dismisses the mapped annotation when invoked from a comment thread', async () => {
			const editor = await openEditor('target()');
			const filePath = toRelativeEditorPath(editor);
			editor.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0));
			const service = new FakeAnnotationWorkspaceService(
				createStore({
					sessions: [createSession('session-1', [createAnnotation('annotation-1', 'target()', 0, 8, filePath)])],
				}),
			);
			const thread = createCommentThread(editor.document.uri);

			const result = await executeDismissAnnotationCommand({
				window: createWindowApi(editor),
				getWorkspaceService: async () => service,
				sessionSelectionService: createSessionSelectionService(),
				commentProjection: {
					getAnnotationId: (candidate) => candidate === thread ? 'annotation-1' : undefined,
				},
				contextKeys: { refresh: async () => undefined, dispose: () => undefined },
			}, thread);

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

		// Scenario: Given a clicked comment with an attached thread, When dismiss runs from the comments surface, Then the mapped annotation is dismissed through the comment's thread.
		test('dismisses the mapped annotation when invoked from a comment object', async () => {
			const editor = await openEditor('target()');
			const filePath = toRelativeEditorPath(editor);
			editor.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0));
			const service = new FakeAnnotationWorkspaceService(
				createStore({
					sessions: [createSession('session-1', [createAnnotation('annotation-1', 'target()', 0, 8, filePath)])],
				}),
			);
			const thread = createCommentThread(editor.document.uri);
			const comment = createComment(thread);

			const result = await executeDismissAnnotationCommand({
				window: createWindowApi(editor),
				getWorkspaceService: async () => service,
				sessionSelectionService: createSessionSelectionService(),
				commentProjection: {
					getAnnotationId: (candidate) => candidate === thread ? 'annotation-1' : undefined,
				},
				contextKeys: { refresh: async () => undefined, dispose: () => undefined },
			}, comment as unknown as Parameters<typeof executeDismissAnnotationCommand>[1]);

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

	// Scenario: Given executeAddOrEditAnnotationCommand where the selection overlaps two annotations, When the command runs, Then it shows a warning and returns blocked with invalidSelection reason.
	test('returns blocked with invalidSelection when selection conflicts with multiple annotations', async () => {
		const editor = await openEditor('export function activate()');
		const filePath = toRelativeEditorPath(editor);
		// Selection spans (0,0)-(0,15), overlapping annotation-1 (0,0)-(0,11) and annotation-2 (0,7)-(0,19).
		editor.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 15));

		const service = new FakeAnnotationWorkspaceService(
			createStore({
				sessions: [
					createSession('session-1', [
						createAnnotation('annotation-1', 'export funct', 0, 11, filePath),
						createAnnotation('annotation-2', 'function activ', 7, 19, filePath),
					]),
				],
			}),
		);
		const warningMessages: string[] = [];

		const result = await executeAddOrEditAnnotationCommand({
			window: createWindowApi(editor, {
				showWarningMessage: (async (message: string) => {
					warningMessages.push(message);
					return undefined;
				}) as typeof vscode.window.showWarningMessage,
			}),
			getWorkspaceService: async () => service,
			sessionSelectionService: createSessionSelectionService(),
		});

		assert.strictEqual(result.status, 'blocked');
		assert.strictEqual((result as { reason: string }).reason, 'invalidSelection');
		assert.ok(warningMessages.length > 0, 'Expected a warning message to be shown');
	});

	// Scenario: Given a selection that partially overlaps one annotation, When a direct dismiss command runs, Then it resolves that annotation and dismisses it.
	test('dismisses an annotation for a single partial-overlap selection', async () => {
		const editor = await openEditor('export function activate()');
		const filePath = toRelativeEditorPath(editor);
		editor.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 15));
		const service = new FakeAnnotationWorkspaceService(
			createStore({
				sessions: [
					createSession('session-1', [createAnnotation('annotation-1', 'export function activate', 0, 22, filePath)]),
				],
			}),
		);

		const result = await executeDismissAnnotationCommand({
			window: createWindowApi(editor),
			getWorkspaceService: async () => service,
			sessionSelectionService: createSessionSelectionService(),
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

	// Scenario: Given executeExistingAnnotationAction with an empty cursor selection, When the command runs, Then reanchor is not included in the available actions passed to pickExistingAnnotationAction.
	test('executeExistingAnnotationAction with empty selection does not offer reanchor', async () => {
		const editor = await openEditor('export function activate()');
		const filePath = toRelativeEditorPath(editor);
		// Empty cursor at (0, 5) — inside annotation range (0,0)-(0,22).
		editor.selection = new vscode.Selection(new vscode.Position(0, 5), new vscode.Position(0, 5));

		const service = new FakeAnnotationWorkspaceService(
			createStore({
				sessions: [
					createSession('session-1', [createAnnotation('annotation-1', 'export function activate', 0, 22, filePath)]),
				],
			}),
		);
		let capturedAvailableActions: ExistingAnnotationAction[] | undefined;
		const inputService: AnnotationInputService = {
			promptForAnnotationBody: async () => 'body',
			pickExistingAnnotationAction: async (_annotation, availableActions) => {
				capturedAvailableActions = availableActions;
				return 'edit';
			},
			confirmPurgeDismissed: async () => true,
			confirmReanchor: async () => true,
		};

		await executeAddOrEditAnnotationCommand({
			window: createWindowApi(editor),
			getWorkspaceService: async () => service,
			sessionSelectionService: createSessionSelectionService(),
			inputService,
		});

		assert.ok(capturedAvailableActions !== undefined, 'Expected pickExistingAnnotationAction to be called');
		assert.ok(
			!capturedAvailableActions.includes('reanchor'),
			'Expected reanchor not to be in available actions for empty selection',
		);
	});

		// Scenario: Given a clicked annotation comment thread and a non-empty editor selection, When add-or-edit runs from the comments surface, Then it still omits one-click reanchor from the available actions.
		test('comment-thread add-or-edit does not offer reanchor even with an active editor selection', async () => {
			const editor = await openEditor('export function activate()');
			const filePath = toRelativeEditorPath(editor);
			editor.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 22));
			const service = new FakeAnnotationWorkspaceService(
				createStore({
					sessions: [
						createSession('session-1', [createAnnotation('annotation-1', 'export function activate', 0, 22, filePath)]),
					],
				}),
			);
			const thread = createCommentThread(editor.document.uri);
			let capturedAvailableActions: ExistingAnnotationAction[] | undefined;

			const result = await executeAddOrEditAnnotationCommand({
				window: createWindowApi(editor),
				getWorkspaceService: async () => service,
				sessionSelectionService: createSessionSelectionService(),
				inputService: {
					promptForAnnotationBody: async () => 'body',
					pickExistingAnnotationAction: async (_annotation, availableActions) => {
						capturedAvailableActions = availableActions;
						return undefined;
					},
					confirmPurgeDismissed: async () => true,
					confirmReanchor: async () => true,
				},
				commentProjection: {
					getAnnotationId: (candidate: vscode.CommentThread) => candidate === thread ? 'annotation-1' : undefined,
				},
			}, thread);

			assert.deepStrictEqual(result, {
				status: 'cancelled',
				commandId: annotationCommandIds.addOrEditAnnotation,
				workspaceFolder: workspaceFolder().uri.fsPath,
			});
			assert.ok(capturedAvailableActions !== undefined, 'Expected pickExistingAnnotationAction to be called');
			assert.ok(capturedAvailableActions.includes('edit'));
			assert.ok(capturedAvailableActions.includes('resolve'));
			assert.ok(capturedAvailableActions.includes('dismiss'));
			assert.ok(!capturedAvailableActions.includes('reanchor'));
		});

	// Scenario: Given an active annotation and resolve selected in quick-pick, When executeAddOrEditAnnotationCommand runs, Then resolveAnnotation is called and annotationResolved is returned.
	test('resolve action in quick-pick calls resolveAnnotation and returns annotationResolved', async () => {
		const editor = await openEditor('target()');
		const filePath = toRelativeEditorPath(editor);
		editor.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 8));
		const service = new FakeAnnotationWorkspaceService(
			createStore({
				sessions: [createSession('session-1', [createAnnotation('annotation-1', 'target()', 0, 8, filePath)])],
			}),
		);

		const result = await executeAddOrEditAnnotationCommand({
			window: createWindowApi(editor),
			getWorkspaceService: async () => service,
			sessionSelectionService: createSessionSelectionService(),
			inputService: {
				promptForAnnotationBody: async () => 'body',
				pickExistingAnnotationAction: async () => 'resolve',
				confirmPurgeDismissed: async () => true,
				confirmReanchor: async () => true,
			},
			contextKeys: { refresh: async () => undefined, dispose: () => undefined },
		});

		assert.deepStrictEqual(result, {
			status: 'ready',
			commandId: annotationCommandIds.addOrEditAnnotation,
			workspaceFolder: workspaceFolder().uri.fsPath,
			operation: 'annotationResolved',
			annotationId: 'annotation-1',
			sessionId: undefined,
			purgedCount: undefined,
		});
		assert.strictEqual(service.store.sessions[0]?.annotations[0]?.status, 'resolved');
	});

		// Scenario: Given a clicked annotation comment thread, When add-or-edit selects resolve, Then it reaches the same lifecycle outcome as the editor quick-pick flow.
		test('comment-thread add-or-edit resolves the mapped annotation through the shared action path', async () => {
			const editor = await openEditor('target()');
			const filePath = toRelativeEditorPath(editor);
			editor.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0));
			const service = new FakeAnnotationWorkspaceService(
				createStore({
					sessions: [createSession('session-1', [createAnnotation('annotation-1', 'target()', 0, 8, filePath)])],
				}),
			);
			const thread = createCommentThread(editor.document.uri);

			const result = await executeAddOrEditAnnotationCommand({
				window: createWindowApi(editor),
				getWorkspaceService: async () => service,
				sessionSelectionService: createSessionSelectionService(),
				inputService: {
					promptForAnnotationBody: async () => 'body',
					pickExistingAnnotationAction: async () => 'resolve',
					confirmPurgeDismissed: async () => true,
					confirmReanchor: async () => true,
				},
				commentProjection: {
					getAnnotationId: (candidate: vscode.CommentThread) => candidate === thread ? 'annotation-1' : undefined,
				},
				contextKeys: { refresh: async () => undefined, dispose: () => undefined },
			}, thread);

			assert.deepStrictEqual(result, {
				status: 'ready',
				commandId: annotationCommandIds.addOrEditAnnotation,
				workspaceFolder: workspaceFolder().uri.fsPath,
				operation: 'annotationResolved',
				annotationId: 'annotation-1',
				sessionId: undefined,
				purgedCount: undefined,
			});
			assert.strictEqual(service.store.sessions[0]?.annotations[0]?.status, 'resolved');
		});

	// Scenario: Given an active annotation selected in the editor, When the direct resolve command runs, Then it resolves the annotation.
	test('resolves the annotation at the current editor selection', async () => {
		const editor = await openEditor('target()');
		const filePath = toRelativeEditorPath(editor);
		editor.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 8));
		const service = new FakeAnnotationWorkspaceService(
			createStore({
				sessions: [createSession('session-1', [createAnnotation('annotation-1', 'target()', 0, 8, filePath)])],
			}),
		);

		const result = await executeResolveAnnotationCommand({
			window: createWindowApi(editor),
			getWorkspaceService: async () => service,
			sessionSelectionService: createSessionSelectionService(),
			contextKeys: { refresh: async () => undefined, dispose: () => undefined },
		});

		assert.deepStrictEqual(result, {
			status: 'ready',
			commandId: annotationCommandIds.resolveAnnotation,
			workspaceFolder: workspaceFolder().uri.fsPath,
			operation: 'annotationResolved',
			annotationId: 'annotation-1',
			sessionId: undefined,
			purgedCount: undefined,
		});
		assert.strictEqual(service.store.sessions[0]?.annotations[0]?.status, 'resolved');
	});

	// Scenario: Given a resolved annotation selected in the editor, When the direct reopen command runs, Then it reopens the annotation.
	test('reopens the annotation at the current editor selection', async () => {
		const editor = await openEditor('target()');
		const filePath = toRelativeEditorPath(editor);
		editor.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 8));
		const service = new FakeAnnotationWorkspaceService(
			createStore({
				sessions: [createSession('session-1', [createAnnotation('annotation-1', 'target()', 0, 8, filePath, 'resolved')])],
			}),
		);

		const result = await executeReopenAnnotationCommand({
			window: createWindowApi(editor),
			getWorkspaceService: async () => service,
			sessionSelectionService: createSessionSelectionService(),
			contextKeys: { refresh: async () => undefined, dispose: () => undefined },
		});

		assert.deepStrictEqual(result, {
			status: 'ready',
			commandId: annotationCommandIds.reopenAnnotation,
			workspaceFolder: workspaceFolder().uri.fsPath,
			operation: 'annotationReopened',
			annotationId: 'annotation-1',
			sessionId: undefined,
			purgedCount: undefined,
		});
		assert.strictEqual(service.store.sessions[0]?.annotations[0]?.status, 'active');
	});

	// Scenario: Given a clicked annotation comment thread, When direct resolve runs from the comments surface, Then the mapped annotation is resolved.
	test('resolves the mapped annotation when invoked from a comment thread', async () => {
		const editor = await openEditor('target()');
		const filePath = toRelativeEditorPath(editor);
		editor.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0));
		const service = new FakeAnnotationWorkspaceService(
			createStore({
				sessions: [createSession('session-1', [createAnnotation('annotation-1', 'target()', 0, 8, filePath)])],
			}),
		);
		const thread = createCommentThread(editor.document.uri);

		const result = await executeResolveAnnotationCommand({
			window: createWindowApi(editor),
			getWorkspaceService: async () => service,
			sessionSelectionService: createSessionSelectionService(),
			commentProjection: {
				getAnnotationId: (candidate: vscode.CommentThread) => candidate === thread ? 'annotation-1' : undefined,
			},
			contextKeys: { refresh: async () => undefined, dispose: () => undefined },
		}, thread);

		assert.strictEqual(result.status, 'ready');
		assert.strictEqual((result as { operation: string }).operation, 'annotationResolved');
		assert.strictEqual(service.store.sessions[0]?.annotations[0]?.status, 'resolved');
	});

	// Scenario: Given a clicked resolved annotation comment, When direct reopen runs from the comments surface, Then the mapped annotation is reopened.
	test('reopens the mapped annotation when invoked from a comment object', async () => {
		const editor = await openEditor('target()');
		const filePath = toRelativeEditorPath(editor);
		editor.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0));
		const service = new FakeAnnotationWorkspaceService(
			createStore({
				sessions: [createSession('session-1', [createAnnotation('annotation-1', 'target()', 0, 8, filePath, 'resolved')])],
			}),
		);
		const thread = createCommentThread(editor.document.uri);
		const comment = createComment(thread);

		const result = await executeReopenAnnotationCommand({
			window: createWindowApi(editor),
			getWorkspaceService: async () => service,
			sessionSelectionService: createSessionSelectionService(),
			commentProjection: {
				getAnnotationId: (candidate: vscode.CommentThread) => candidate === thread ? 'annotation-1' : undefined,
			},
			contextKeys: { refresh: async () => undefined, dispose: () => undefined },
		}, comment as unknown as Parameters<typeof executeReopenAnnotationCommand>[1]);

		assert.strictEqual(result.status, 'ready');
		assert.strictEqual((result as { operation: string }).operation, 'annotationReopened');
		assert.strictEqual(service.store.sessions[0]?.annotations[0]?.status, 'active');
	});

	// Scenario: Given a resolved annotation selected in the editor, When direct resolve runs, Then it blocks without changing status.
	test('direct resolve blocks already resolved annotations', async () => {
		const editor = await openEditor('target()');
		const filePath = toRelativeEditorPath(editor);
		editor.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 8));
		const service = new FakeAnnotationWorkspaceService(
			createStore({
				sessions: [createSession('session-1', [createAnnotation('annotation-1', 'target()', 0, 8, filePath, 'resolved')])],
			}),
		);

		const result = await executeResolveAnnotationCommand({
			window: createWindowApi(editor),
			getWorkspaceService: async () => service,
			sessionSelectionService: createSessionSelectionService(),
		});

		assert.strictEqual(result.status, 'blocked');
		assert.strictEqual((result as { reason: string }).reason, 'invalidAnnotationStatus');
		assert.strictEqual(service.store.sessions[0]?.annotations[0]?.status, 'resolved');
	});

	// Scenario: Given an active annotation selected in the editor, When direct reopen runs, Then it blocks without changing status.
	test('direct reopen blocks already active annotations', async () => {
		const editor = await openEditor('target()');
		const filePath = toRelativeEditorPath(editor);
		editor.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 8));
		const service = new FakeAnnotationWorkspaceService(
			createStore({
				sessions: [createSession('session-1', [createAnnotation('annotation-1', 'target()', 0, 8, filePath)])],
			}),
		);

		const result = await executeReopenAnnotationCommand({
			window: createWindowApi(editor),
			getWorkspaceService: async () => service,
			sessionSelectionService: createSessionSelectionService(),
		});

		assert.strictEqual(result.status, 'blocked');
		assert.strictEqual((result as { reason: string }).reason, 'invalidAnnotationStatus');
		assert.strictEqual(service.store.sessions[0]?.annotations[0]?.status, 'active');
	});

	// Scenario: Given a dismissed annotation selected in the editor, When direct resolve runs, Then direct management treats it as unavailable.
	test('direct resolve does not target dismissed annotations from editor selection', async () => {
		const editor = await openEditor('target()');
		const filePath = toRelativeEditorPath(editor);
		editor.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 8));
		const service = new FakeAnnotationWorkspaceService(
			createStore({
				sessions: [createSession('session-1', [createAnnotation('annotation-1', 'target()', 0, 8, filePath, 'dismissed')])],
			}),
		);

		const result = await executeResolveAnnotationCommand({
			window: createWindowApi(editor),
			getWorkspaceService: async () => service,
			sessionSelectionService: createSessionSelectionService(),
		});

		assert.strictEqual(result.status, 'blocked');
		assert.strictEqual((result as { reason: string }).reason, 'annotationNotFound');
		assert.strictEqual(service.store.sessions[0]?.annotations[0]?.status, 'dismissed');
	});

	// Scenario: Given a resolved annotation and reopen selected in quick-pick, When executeAddOrEditAnnotationCommand runs, Then reopenAnnotation is called and annotationReopened is returned.
	test('reopen action in quick-pick calls reopenAnnotation and returns annotationReopened', async () => {
		const editor = await openEditor('target()');
		const filePath = toRelativeEditorPath(editor);
		editor.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 8));
		const service = new FakeAnnotationWorkspaceService(
			createStore({
				sessions: [createSession('session-1', [createAnnotation('annotation-1', 'target()', 0, 8, filePath, 'resolved')])],
			}),
		);

		const result = await executeAddOrEditAnnotationCommand({
			window: createWindowApi(editor),
			getWorkspaceService: async () => service,
			sessionSelectionService: createSessionSelectionService(),
			inputService: {
				promptForAnnotationBody: async () => 'body',
				pickExistingAnnotationAction: async () => 'reopen',
				confirmPurgeDismissed: async () => true,
				confirmReanchor: async () => true,
			},
			contextKeys: { refresh: async () => undefined, dispose: () => undefined },
		});

		assert.deepStrictEqual(result, {
			status: 'ready',
			commandId: annotationCommandIds.addOrEditAnnotation,
			workspaceFolder: workspaceFolder().uri.fsPath,
			operation: 'annotationReopened',
			annotationId: 'annotation-1',
			sessionId: undefined,
			purgedCount: undefined,
		});
		assert.strictEqual(service.store.sessions[0]?.annotations[0]?.status, 'active');
	});

	// Scenario: Given an active annotation, When executeAddOrEditAnnotationCommand runs, Then reopen is not in the available actions.
	test('active annotation does not offer reopen in available actions', async () => {
		const editor = await openEditor('export function activate()');
		const filePath = toRelativeEditorPath(editor);
		editor.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 22));
		const service = new FakeAnnotationWorkspaceService(
			createStore({
				sessions: [
					createSession('session-1', [createAnnotation('annotation-1', 'export function activate', 0, 22, filePath)]),
				],
			}),
		);
		let capturedAvailableActions: ExistingAnnotationAction[] | undefined;
		const inputService: AnnotationInputService = {
			promptForAnnotationBody: async () => 'body',
			pickExistingAnnotationAction: async (_annotation, availableActions) => {
				capturedAvailableActions = availableActions;
				return 'edit';
			},
			confirmPurgeDismissed: async () => true,
			confirmReanchor: async () => true,
		};

		await executeAddOrEditAnnotationCommand({
			window: createWindowApi(editor),
			getWorkspaceService: async () => service,
			sessionSelectionService: createSessionSelectionService(),
			inputService,
		});

		assert.ok(capturedAvailableActions !== undefined, 'Expected pickExistingAnnotationAction to be called');
		assert.ok(!capturedAvailableActions.includes('reopen'), 'Expected reopen not to be in available actions for active annotation');
	});

	// Scenario: Given a resolved annotation, When executeAddOrEditAnnotationCommand runs, Then resolve is not in the available actions.
	test('resolved annotation does not offer resolve in available actions', async () => {
		const editor = await openEditor('export function activate()');
		const filePath = toRelativeEditorPath(editor);
		editor.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 22));
		const service = new FakeAnnotationWorkspaceService(
			createStore({
				sessions: [
					createSession('session-1', [createAnnotation('annotation-1', 'export function activate', 0, 22, filePath, 'resolved')]),
				],
			}),
		);
		let capturedAvailableActions: ExistingAnnotationAction[] | undefined;
		const inputService: AnnotationInputService = {
			promptForAnnotationBody: async () => 'body',
			pickExistingAnnotationAction: async (_annotation, availableActions) => {
				capturedAvailableActions = availableActions;
				return 'edit';
			},
			confirmPurgeDismissed: async () => true,
			confirmReanchor: async () => true,
		};

		await executeAddOrEditAnnotationCommand({
			window: createWindowApi(editor),
			getWorkspaceService: async () => service,
			sessionSelectionService: createSessionSelectionService(),
			inputService,
		});

		assert.ok(capturedAvailableActions !== undefined, 'Expected pickExistingAnnotationAction to be called');
		assert.ok(!capturedAvailableActions.includes('resolve'), 'Expected resolve not to be in available actions for resolved annotation');
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

function createCommentThread(uri: vscode.Uri): vscode.CommentThread {
	return {
		uri,
		range: new vscode.Range(0, 0, 0, 8),
		canReply: false,
		collapsibleState: vscode.CommentThreadCollapsibleState.Expanded,
		comments: [],
		dispose: () => undefined,
	} as unknown as vscode.CommentThread;
}

function createComment(thread: vscode.CommentThread): vscode.Comment & { thread: vscode.CommentThread } {
	return {
		body: 'Validate this call path.',
		author: { name: 'Security pass' },
		mode: vscode.CommentMode.Preview,
		thread,
	} as vscode.Comment & { thread: vscode.CommentThread };
}

function createStore(overrides: Partial<AnnotationStore> = {}): AnnotationStore {
	return {
		schemaVersion: annotationSchemaVersion,
		activeSessionId: 'session-1',
		sessions: [createSession('session-1')],
		...overrides,
	};
}

function createSession(
	sessionId: string,
	annotations = [createAnnotation('annotation-1')],
	name = 'Security pass',
	updatedAt = '2026-05-20T10:00:00.000Z',
) {
	return {
		sessionId,
		name,
		sessionSlug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
		createdAt: '2026-05-20T10:00:00.000Z',
		updatedAt,
		annotations,
	};
}

function createAnnotation(
	annotationId: string,
	selectedText = 'export function activate',
	startCharacter = 0,
	endCharacter = 22,
	filePath = 'src/extension.ts',
	status: 'active' | 'resolved' | 'dismissed' = 'active',
) {
	return {
		annotationId,
		status,
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

class FakeAnnotationWorkspaceService implements Pick<AnnotationWorkspaceService, 'getState' | 'initialize' | 'createAnnotation' | 'updateAnnotation' | 'dismissAnnotation' | 'reanchorAnnotation' | 'purgeDismissedAnnotations' | 'generateDraftOutput' | 'setActiveSession' | 'resolveAnnotation' | 'reopenAnnotation'> {
	public readonly projection;
	public readonly reanchorCalls: unknown[] = [];
	public readonly deletedSessionIds = new Set<string>();
	public readonly clearedSessionIds = new Set<string>();

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

	public async deleteSession(sessionId: string): Promise<AnnotationWorkspaceMutationResult> {
		if (this.deletedSessionIds.has(sessionId)) {
			return {
				status: 'blocked',
				reason: 'sessionNotFound',
				message: 'The selected review session could not be found.',
				storePath,
			};
		}

		const index = this.store.sessions.findIndex((session) => session.sessionId === sessionId);
		if (index === -1) {
			return {
				status: 'blocked',
				reason: 'sessionNotFound',
				message: 'The selected review session could not be found.',
				storePath,
			};
		}

		this.store.sessions.splice(index, 1);
		if (this.store.activeSessionId === sessionId) {
			this.store.activeSessionId = this.store.sessions.reduce<string | null>((activeId, session) => {
				if (!activeId) {
					return session.sessionId;
				}

				const activeSession = this.store.sessions.find((entry) => entry.sessionId === activeId);
				return activeSession && activeSession.updatedAt >= session.updatedAt ? activeId : session.sessionId;
			}, null);
		}

		return {
			status: 'ready',
			projection: deriveAnnotationWorkspaceProjection(workspaceFolder().uri.fsPath, this.store),
			storePath,
			sessionId: this.store.activeSessionId ?? undefined,
		};
	}

	public async clearSessionAnnotations(sessionId: string): Promise<AnnotationWorkspaceMutationResult> {
		if (this.clearedSessionIds.has(sessionId)) {
			return {
				status: 'blocked',
				reason: 'sessionNotFound',
				message: 'The selected review session could not be found.',
				storePath,
			};
		}

		const session = this.store.sessions.find((entry) => entry.sessionId === sessionId);
		if (!session) {
			return {
				status: 'blocked',
				reason: 'sessionNotFound',
				message: 'The selected review session could not be found.',
				storePath,
			};
		}

		session.annotations = [];
		session.updatedAt = '2026-05-20T12:00:00.000Z';
		return {
			status: 'ready',
			projection: deriveAnnotationWorkspaceProjection(workspaceFolder().uri.fsPath, this.store),
			storePath,
			sessionId,
		};
	}

	public async resolveAnnotation(annotationId: string): Promise<AnnotationWorkspaceMutationResult> {
		const annotation = this.store.sessions[0]?.annotations.find((entry) => entry.annotationId === annotationId);
		if (annotation?.status !== 'active') {
			return {
				status: 'blocked',
				reason: 'invalidAnnotationStatus',
				message: 'Only active annotations can be resolved.',
				storePath,
			};
		}
		if (annotation) {
			annotation.status = 'resolved';
		}
		const projection = deriveAnnotationWorkspaceProjection(workspaceFolder().uri.fsPath, this.store);
		return {
			status: 'ready',
			projection,
			storePath,
			annotation: projection.annotations.find((entry) => entry.annotationId === annotationId),
		};
	}

	public async reopenAnnotation(annotationId: string): Promise<AnnotationWorkspaceMutationResult> {
		const annotation = this.store.sessions[0]?.annotations.find((entry) => entry.annotationId === annotationId);
		if (annotation?.status !== 'resolved') {
			return {
				status: 'blocked',
				reason: 'invalidAnnotationStatus',
				message: 'Only resolved annotations can be reopened.',
				storePath,
			};
		}
		if (annotation) {
			annotation.status = 'active';
		}
		const projection = deriveAnnotationWorkspaceProjection(workspaceFolder().uri.fsPath, this.store);
		return {
			status: 'ready',
			projection,
			storePath,
			annotation: projection.annotations.find((entry) => entry.annotationId === annotationId),
		};
	}
}