import * as assert from 'assert';
import {
	createVscodeAnnotationInputService,
	type ExistingAnnotationAction,
} from '../../annotations/presentation/annotationInput';
import {
	createSessionMaintenanceQuickPickItems,
	createVscodeSessionMaintenanceQuickPickPresenter,
} from '../../annotations/presentation/sessionMaintenanceQuickPick';
import {
	createSessionQuickPickItems,
	createVscodeSessionQuickPickPresenter,
	type SessionQuickPickItem,
} from '../../annotations/presentation/sessionQuickPick';
import type {
	AnnotationProjectionEntry,
	AnnotationSessionProjection,
	AnnotationWorkspaceProjection,
} from '../../annotations/application/projectionModel';

suite('Presentation Input Helpers', () => {
	// Scenario: Given a workspace projection with active and inactive sessions, When quick-pick items are created, Then session metadata is preserved and the create action is appended.
	test('creates session quick-pick items and appends the create action', () => {
		const items = createSessionQuickPickItems(createWorkspaceProjection());

		assert.deepStrictEqual(items, [
			{
				type: 'session',
				sessionId: 'session-1',
				label: 'Security pass',
				description: 'Active session',
				detail: '3 annotations, 1 dismissed',
			},
			{
				type: 'session',
				sessionId: 'session-2',
				label: 'Bug bash',
				description: undefined,
				detail: '1 annotations, 0 dismissed',
			},
			{
				type: 'create',
				label: 'Create new session...',
				detail: 'Create and activate a new review session.',
			},
		]);
	});

	// Scenario: Given an active session entry, When the session presenter opens the picker, Then that entry is preselected and its mapped result is returned.
	test('presents session quick-pick items and returns the mapped selection', async () => {
		const calls: Array<{ items: Array<SessionQuickPickItem & { picked?: boolean }>; options: unknown }> = [];
		const presenter = createVscodeSessionQuickPickPresenter({
			showQuickPick: async (items, options) => {
				calls.push({ items: [...items], options });
				return items[0];
			},
			showInputBox: async () => undefined,
		});

		const result = await presenter.pickSession(createSessionQuickPickItems(createWorkspaceProjection()));

		assert.deepStrictEqual(result, {
			type: 'session',
			sessionId: 'session-1',
			label: 'Security pass',
			description: 'Active session',
			detail: '3 annotations, 1 dismissed',
		});
		assert.strictEqual(calls.length, 1);
		assert.strictEqual(calls[0]?.items[0]?.picked, true);
		assert.strictEqual(calls[0]?.items[1]?.picked, false);
		assert.deepStrictEqual(calls[0]?.options, {
			title: 'AI Toolkit: Select Review Session',
			placeHolder: 'Choose the active review session.',
			ignoreFocusOut: true,
		});
	});

	// Scenario: Given a create action is selected, When the presenter maps the VS Code result, Then it returns a create item without a synthetic session id.
	test('maps a create-session selection back to a create item', async () => {
		const presenter = createVscodeSessionQuickPickPresenter({
			showQuickPick: async (items) => items[items.length - 1],
			showInputBox: async () => undefined,
		});

		const result = await presenter.pickSession(createSessionQuickPickItems(createWorkspaceProjection()));

		assert.deepStrictEqual(result, {
			type: 'create',
			label: 'Create new session...',
			description: undefined,
			detail: 'Create and activate a new review session.',
		});
	});

	// Scenario: Given a selected session item without a session id, When the presenter maps the VS Code result, Then it falls back to an empty session id.
	test('maps session selections without a session id to an empty string', async () => {
		const presenter = createVscodeSessionQuickPickPresenter({
			showQuickPick: async () => ({
				type: 'session',
				label: 'Recovered session',
				description: undefined,
				detail: '0 annotations, 0 dismissed',
			}),
			showInputBox: async () => undefined,
		});

		const result = await presenter.pickSession(createSessionQuickPickItems(createWorkspaceProjection()));

		assert.deepStrictEqual(result, {
			type: 'session',
			sessionId: '',
			label: 'Recovered session',
			description: undefined,
			detail: '0 annotations, 0 dismissed',
		});
	});

	// Scenario: Given no quick-pick selection, When the presenter completes, Then it returns undefined.
	test('returns undefined when no session is selected', async () => {
		const presenter = createVscodeSessionQuickPickPresenter({
			showQuickPick: async () => undefined,
			showInputBox: async () => undefined,
		});

		const result = await presenter.pickSession(createSessionQuickPickItems(createWorkspaceProjection()));

		assert.strictEqual(result, undefined);
	});

	// Scenario: Given a suggested session name, When the presenter prompts for a new session, Then it passes the expected input-box configuration and validation rules.
	test('prompts for a new session name with validation', async () => {
		let receivedOptions:
			| {
				title: string;
				prompt: string;
				value: string;
				ignoreFocusOut: boolean;
				validateInput: (value: string) => string | undefined;
			}
			| undefined;
		const presenter = createVscodeSessionQuickPickPresenter({
			showQuickPick: async () => undefined,
			showInputBox: async (options) => {
				receivedOptions = options;
				return 'Release readiness';
			},
		});

		const result = await presenter.promptForNewSessionName('Security pass');

		assert.strictEqual(result, 'Release readiness');
		assert.deepStrictEqual(
			receivedOptions && {
				title: receivedOptions.title,
				prompt: receivedOptions.prompt,
				value: receivedOptions.value,
				ignoreFocusOut: receivedOptions.ignoreFocusOut,
			},
			{
				title: 'AI Toolkit: Create Review Session',
				prompt: 'Enter a review session name.',
				value: 'Security pass',
				ignoreFocusOut: true,
			},
		);
		assert.strictEqual(receivedOptions?.validateInput('   '), 'Review session name is required.');
		assert.strictEqual(receivedOptions?.validateInput('Ready for merge'), undefined);
	});

	// Scenario: Given review sessions with different update times, When maintenance items are created, Then they are sorted newest-first and the active session is labeled.
	test('creates sorted maintenance quick-pick items', () => {
		const items = createSessionMaintenanceQuickPickItems(createSessions());

		assert.deepStrictEqual(items, [
			{
				type: 'session',
				sessionId: 'session-2',
				label: 'Bug bash',
				isActive: false,
				description: undefined,
				detail: '1 annotations, 0 dismissed, updated 2026-05-23T09:00:00.000Z',
				annotationCount: 1,
				updatedAt: '2026-05-23T09:00:00.000Z',
			},
			{
				type: 'session',
				sessionId: 'session-1',
				label: 'Security pass',
				isActive: true,
				description: 'Active session',
				detail: '3 annotations, 1 dismissed, updated 2026-05-22T10:05:00.000Z',
				annotationCount: 3,
				updatedAt: '2026-05-22T10:05:00.000Z',
			},
		]);
	});

	// Scenario: Given a delete operation, When the maintenance presenter opens the picker, Then it uses delete-specific copy and returns the selected item.
	test('presents delete maintenance quick-pick items with delete copy', async () => {
		const calls: Array<{ options: unknown }> = [];
		const items = createSessionMaintenanceQuickPickItems(createSessions());
		const presenter = createVscodeSessionMaintenanceQuickPickPresenter({
			showQuickPick: async (inputItems, options) => {
				calls.push({ options });
				return inputItems[0];
			},
		});

		const result = await presenter.pickSession('delete', items);

		assert.deepStrictEqual(result, items[0]);
		assert.deepStrictEqual(calls[0]?.options, {
			title: 'AI Toolkit: Delete Review Session',
			placeHolder: 'Choose the review session to delete.',
			ignoreFocusOut: true,
		});
	});

	// Scenario: Given a clear operation and no selection, When the maintenance presenter opens the picker, Then it uses clear-specific copy and returns undefined.
	test('presents clear maintenance quick-pick items with clear copy', async () => {
		let receivedOptions: unknown;
		const presenter = createVscodeSessionMaintenanceQuickPickPresenter({
			showQuickPick: async (_items, options) => {
				receivedOptions = options;
				return undefined;
			},
		});

		const result = await presenter.pickSession('clear', createSessionMaintenanceQuickPickItems(createSessions()));

		assert.strictEqual(result, undefined);
		assert.deepStrictEqual(receivedOptions, {
			title: 'AI Toolkit: Clear Review Session Annotations',
			placeHolder: 'Choose the review session to clear.',
			ignoreFocusOut: true,
		});
	});

	// Scenario: Given an empty annotation body, When the annotation input service prompts for content, Then it uses add-specific copy and rejects blank input.
	test('prompts for a new annotation body with validation', async () => {
		let receivedOptions:
			| {
				title: string;
				prompt: string;
				value: string | undefined;
				ignoreFocusOut: boolean;
				validateInput: (value: string) => string | undefined;
			}
			| undefined;
		const service = createVscodeAnnotationInputService({
			showInputBox: async (options) => {
				receivedOptions = options;
				return 'Document missing null check';
			},
			showQuickPick: async () => undefined,
			showWarningMessage: async () => undefined,
		});

		const result = await service.promptForAnnotationBody();

		assert.strictEqual(result, 'Document missing null check');
		assert.deepStrictEqual(
			receivedOptions && {
				title: receivedOptions.title,
				prompt: receivedOptions.prompt,
				value: receivedOptions.value,
				ignoreFocusOut: receivedOptions.ignoreFocusOut,
			},
			{
				title: 'AI Toolkit: Add Annotation',
				prompt: 'Enter the annotation body.',
				value: undefined,
				ignoreFocusOut: true,
			},
		);
		assert.strictEqual(receivedOptions?.validateInput('   '), 'Annotation body is required.');
		assert.strictEqual(receivedOptions?.validateInput('Looks good'), undefined);
	});

	// Scenario: Given an existing annotation body, When the annotation input service prompts for content, Then it uses edit-specific copy and preserves the initial value.
	test('prompts for editing an annotation body', async () => {
		let receivedTitle: string | undefined;
		let receivedValue: string | undefined;
		const service = createVscodeAnnotationInputService({
			showInputBox: async (options) => {
				receivedTitle = options.title;
				receivedValue = options.value;
				return 'Updated body';
			},
			showQuickPick: async () => undefined,
			showWarningMessage: async () => undefined,
		});

		const result = await service.promptForAnnotationBody('Initial body');

		assert.strictEqual(result, 'Updated body');
		assert.strictEqual(receivedTitle, 'AI Toolkit: Edit Annotation');
		assert.strictEqual(receivedValue, 'Initial body');
	});

	// Scenario: Given a dismissed annotation and available actions, When the action picker opens, Then the service maps labels and returns the selected action token.
	test('picks an existing annotation action using mapped labels', async () => {
		let receivedItems:
			| Array<{ label: string; description?: string; action: ExistingAnnotationAction }>
			| undefined;
		let receivedOptions: unknown;
		const service = createVscodeAnnotationInputService({
			showInputBox: async () => undefined,
			showQuickPick: async (items, options) => {
				receivedItems = [...items];
				receivedOptions = options;
				return items[0];
			},
			showWarningMessage: async () => undefined,
		});

		const result = await service.pickExistingAnnotationAction(
			createAnnotationEntry('dismissed'),
			['edit', 'resolve', 'reopen', 'dismiss', 'reanchor'],
		);

		assert.strictEqual(result, 'edit');
		assert.deepStrictEqual(receivedItems, [
			{ label: 'Edit annotation body', description: 'Currently dismissed', action: 'edit' },
			{ label: 'Resolve annotation', description: undefined, action: 'resolve' },
			{ label: 'Reopen annotation', description: undefined, action: 'reopen' },
			{ label: 'Dismiss annotation', description: undefined, action: 'dismiss' },
			{ label: 'Reanchor annotation', description: undefined, action: 'reanchor' },
		]);
		assert.deepStrictEqual(receivedOptions, {
			title: 'AI Toolkit: Add or Edit Annotation',
			placeHolder: 'Choose how to manage the selected annotation.',
			ignoreFocusOut: true,
		});
	});

	// Scenario: Given an active annotation and edit is selected, When the action picker opens, Then the edit option carries no dismissed description.
	test('omits the dismissed description for edit on active annotations', async () => {
		let receivedItems:
			| Array<{ label: string; description?: string; action: ExistingAnnotationAction }>
			| undefined;
		const service = createVscodeAnnotationInputService({
			showInputBox: async () => undefined,
			showQuickPick: async (items) => {
				receivedItems = [...items];
				return items[0];
			},
			showWarningMessage: async () => undefined,
		});

		const result = await service.pickExistingAnnotationAction(createAnnotationEntry('active'), ['edit']);

		assert.strictEqual(result, 'edit');
		assert.deepStrictEqual(receivedItems, [
			{ label: 'Edit annotation body', description: undefined, action: 'edit' },
		]);
	});

	// Scenario: Given no action selection, When the action picker completes, Then the service returns undefined.
	test('returns undefined when no annotation action is selected', async () => {
		const service = createVscodeAnnotationInputService({
			showInputBox: async () => undefined,
			showQuickPick: async () => undefined,
			showWarningMessage: async () => undefined,
		});

		const result = await service.pickExistingAnnotationAction(createAnnotationEntry('active'), ['resolve']);

		assert.strictEqual(result, undefined);
	});

	// Scenario: Given confirmation prompts for purge and reanchor, When the destructive choice is selected, Then the service returns true and uses the expected message text.
	test('confirms purge and reanchor operations', async () => {
		const calls: Array<{ message: string; choice: string }> = [];
		const responses = ['Purge', 'Reanchor'];
		const service = createVscodeAnnotationInputService({
			showInputBox: async () => undefined,
			showQuickPick: async () => undefined,
			showWarningMessage: async (message, _options, choice) => {
				calls.push({ message, choice: choice as string });
				return responses.shift();
			},
		});

		const purgeConfirmed = await service.confirmPurgeDismissed(2);
		const reanchorConfirmed = await service.confirmReanchor();

		assert.strictEqual(purgeConfirmed, true);
		assert.strictEqual(reanchorConfirmed, true);
		assert.deepStrictEqual(calls, [
			{
				message: 'Purge 2 dismissed annotations from the active review session?',
				choice: 'Purge',
			},
			{
				message: 'Reanchor the selected annotation to the current editor selection?',
				choice: 'Reanchor',
			},
		]);
	});

	// Scenario: Given singular and inactive destructive confirmations, When the matching destructive choice is selected, Then singular copy and the inactive-session variant are used.
	test('uses singular and inactive-session confirmation copy', async () => {
		const calls: Array<{ message: string; choice: string }> = [];
		const responses = ['Purge', 'Delete Session', 'Clear Annotations'];
		const service = createVscodeAnnotationInputService({
			showInputBox: async () => undefined,
			showQuickPick: async () => undefined,
			showWarningMessage: async (message, _options, choice) => {
				calls.push({ message, choice: choice as string });
				return responses.shift();
			},
		});

		const purgeConfirmed = await service.confirmPurgeDismissed(1);
		const deleteConfirmed = await service.confirmDeleteSession?.('Review Session 2', 2, false);
		const clearConfirmed = await service.confirmClearSessionAnnotations?.('Review Session 2', 1);

		assert.strictEqual(purgeConfirmed, true);
		assert.strictEqual(deleteConfirmed, true);
		assert.strictEqual(clearConfirmed, true);
		assert.deepStrictEqual(calls, [
			{
				message: 'Purge 1 dismissed annotation from the active review session?',
				choice: 'Purge',
			},
			{
				message: 'Delete review session "Review Session 2" and remove its 2 annotations?',
				choice: 'Delete Session',
			},
			{
				message: 'Clear 1 annotation from review session "Review Session 2"?',
				choice: 'Clear Annotations',
			},
		]);
	});

	// Scenario: Given delete and clear confirmation prompts, When the destructive choice is not selected, Then the service returns false while still using the expected pluralization and active-session copy.
	test('confirms delete and clear session operations with expected copy', async () => {
		const calls: Array<{ message: string; choice: string }> = [];
		const responses = ['Cancel', 'Nope'];
		const service = createVscodeAnnotationInputService({
			showInputBox: async () => undefined,
			showQuickPick: async () => undefined,
			showWarningMessage: async (message, _options, choice) => {
				calls.push({ message, choice: choice as string });
				return responses.shift();
			},
		});

		const deleteConfirmed = await service.confirmDeleteSession?.('Security pass', 1, true);
		const clearConfirmed = await service.confirmClearSessionAnnotations?.('Bug bash', 3);

		assert.strictEqual(deleteConfirmed, false);
		assert.strictEqual(clearConfirmed, false);
		assert.deepStrictEqual(calls, [
			{
				message: 'This is the active review session. Delete review session "Security pass" and remove its 1 annotation?',
				choice: 'Delete Session',
			},
			{
				message: 'Clear 3 annotations from review session "Bug bash"?',
				choice: 'Clear Annotations',
			},
		]);
	});
});

function createWorkspaceProjection(): AnnotationWorkspaceProjection {
	return {
		workspaceFolderPath: 'e:/source/ai-toolkit',
		activeSessionId: 'session-1',
		sessions: createSessions(),
		annotations: [createAnnotationEntry('active')],
		activeAnnotations: [createAnnotationEntry('active')],
		dismissedAnnotationsInActiveSession: 1,
	};
}

function createSessions(): AnnotationSessionProjection[] {
	return [
		{
			sessionId: 'session-1',
			name: 'Security pass',
			sessionSlug: 'security-pass',
			isActive: true,
			annotationCount: 3,
			dismissedCount: 1,
			updatedAt: '2026-05-22T10:05:00.000Z',
		},
		{
			sessionId: 'session-2',
			name: 'Bug bash',
			sessionSlug: 'bug-bash',
			isActive: false,
			annotationCount: 1,
			dismissedCount: 0,
			updatedAt: '2026-05-23T09:00:00.000Z',
		},
	];
}

function createAnnotationEntry(status: AnnotationProjectionEntry['status']): AnnotationProjectionEntry {
	return {
		annotationId: 'annotation-1',
		sessionId: 'session-1',
		sessionName: 'Security pass',
		status,
		anchorState: 'anchored',
		body: 'Check the null path.',
		filePath: 'src/extension.ts',
		range: {
			start: { line: 1, character: 0 },
			end: { line: 1, character: 5 },
		},
		updatedAt: '2026-05-22T10:05:00.000Z',
		isActiveSession: true,
	};
}