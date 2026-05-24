import * as assert from 'assert';
import {
	createAnnotationAnchor,
} from '../../annotations/domain/anchorMatching';
import {
	annotationSchemaVersion,
	type AnnotationStore,
	type PersistedAnnotationStoreVersion,
} from '../../annotations/domain/annotationModels';
import {
	AnnotationStoreValidationError,
	createAnnotationValidationError,
} from '../../annotations/domain/annotationValidation';
import {
	AnnotationWorkspaceService,
	type AnnotationWorkspaceDependencies,
	type AnnotationWorkspaceFileReader,
	type AnnotationWorkspaceFolder,
} from '../../annotations/application/annotationWorkspaceService';
import type { AnnotationSaveResult } from '../../annotations/infrastructure/annotationStorageController';

type TestStorageController = {
	getStorePath(): string;
	load(): Promise<
		| {
			status: 'ready';
			store: AnnotationStore;
			version: PersistedAnnotationStoreVersion;
			storePath: string;
		}
		| {
			status: 'invalid';
			error: AnnotationStoreValidationError;
			storePath: string;
		}
	>;
	save(store: AnnotationStore): Promise<AnnotationSaveResult>;
};

suite('Annotation Workspace Service', () => {
	// Scenario: watcher-triggered refresh failures are logged instead of escaping as unhandled rejections.
	test('logs watcher-triggered refresh failures without dropping the previous state', async () => {
		const refreshError = new Error('refresh failed');
		const logger = createLoggerSpy();
		let triggerWatcher: (() => void) | undefined;
		const storage = new InMemoryStorageController(createStore());
		let loadCount = 0;
		storage.load = async () => {
			loadCount += 1;
			if (loadCount > 1) {
				throw refreshError;
			}

			return {
				status: 'ready' as const,
				store: structuredClone(storage.store),
				version: createVersion('watcher-seed'),
				storePath: storage.getStorePath(),
			};
		};

		const service = new AnnotationWorkspaceService(createWorkspaceFolder(), {
			storage,
			fileReader: {
				readFile: async () => ['before a', 'before b', 'target()', 'after a', 'after b'].join('\n'),
			},
			watcherFactory: (_workspaceFolder, onChange) => {
				triggerWatcher = onChange;
				return { dispose() {} };
			},
			clock: () => new Date('2026-05-20T12:00:00.000Z'),
			idFactory: () => 'generated-id',
			logger,
		});

		const initialState = await service.initialize();
		assert.strictEqual(initialState.status, 'ready');
		assert.ok(triggerWatcher);

		triggerWatcher?.();
		await flushAsyncWork();

		assert.deepStrictEqual(logger.errors, [{
			message: 'Annotation workspace refresh failed after a store watcher update.',
			details: {
				storePath: storage.getStorePath(),
				error: refreshError.message,
			},
		}]);
		assert.deepStrictEqual(service.getState(), initialState);
	});

	// Scenario: creating a first review session persists it as the folder-scoped active session.
	test('creates and activates a review session', async () => {
		const storage = new InMemoryStorageController(createStore({ activeSessionId: null, sessions: [] }));
		const service = createService(storage);

		const result = await service.createSession('Security pass');

		assert.strictEqual(result.status, 'ready');
		if (result.status !== 'ready') {
			return;
		}

		assert.strictEqual(result.projection.activeSessionId, result.sessionId);
		assert.strictEqual(result.projection.sessions.length, 1);
		assert.strictEqual(typeof result.projection.storeContentHash, 'string');
		assert.ok((result.projection.storeContentHash?.length ?? 0) > 0);
		assert.strictEqual(storage.store.activeSessionId, result.sessionId);
	});

	// Scenario: Given state listeners and a watcher, When the workspace refreshes and then the service is disposed, Then listeners receive changes until disposed and the watcher is cleaned up.
	test('notifies listeners until they are disposed and disposes the watcher', async () => {
		const storage = new InMemoryStorageController(createStore());
		const observedStates: string[] = [];
		let watcherDisposed = 0;
		const service = createService(storage, {
			watcherFactory: () => ({
				dispose() {
					watcherDisposed += 1;
				},
			}),
		});

		const listenerDisposable = service.onDidChangeState((state) => {
			observedStates.push(state.status);
		});

		assert.strictEqual(service.getState(), undefined);

		await service.initialize();
		listenerDisposable.dispose();
		await service.refresh();
		service.dispose();
		await service.refresh();

		assert.deepStrictEqual(observedStates, ['ready']);
		assert.strictEqual(watcherDisposed, 1);
	});

	// Scenario: creating an annotation is blocked until an active review session exists.
	test('blocks annotation creation without an active session', async () => {
		const storage = new InMemoryStorageController(createStore({ activeSessionId: null, sessions: [] }));
		const service = createService(storage);

		const result = await service.createAnnotation({
			body: 'Validate the command flow.',
			filePath: 'src/extension.ts',
			anchor: createAnchor(),
		});

		assert.deepStrictEqual(result, {
			status: 'blocked',
			reason: 'noActiveSession',
			message: 'Select a review session before creating an annotation.',
			storePath: storage.getStorePath(),
			error: undefined,
			latestState: undefined,
		});
	});

	// Scenario: invalid store content blocks all workspace mutations until the file is repaired.
	test('blocks mutations when the canonical store is invalid', async () => {
		const invalidError = createAnnotationValidationError('$.activeSessionId', 'activeSessionId must reference a session.');
		const storage = new InvalidStorageController(invalidError);
		const service = createService(storage);

		const result = await service.createSession('Security pass');

		assert.strictEqual(result.status, 'blocked');
		if (result.status !== 'blocked') {
			return;
		}

		assert.strictEqual(result.reason, 'invalidStore');
		assert.strictEqual(result.error, invalidError);
	});

	// Scenario: a mutation save that fails validation transitions the workspace into invalid state and returns the invalid snapshot.
	test('returns invalidStore when persisting a mutation produces an invalid save result', async () => {
		const invalidError = createAnnotationValidationError('$.sessions[0].annotations[0].body', 'body must not be empty.');
		const baseStorage = new InMemoryStorageController(createStore({ activeSessionId: null, sessions: [] }));
		const storage: TestStorageController = {
			getStorePath: () => baseStorage.getStorePath(),
			load: () => baseStorage.load(),
			save: async (_store: AnnotationStore) => ({
				status: 'invalid',
				error: invalidError,
				storePath: baseStorage.getStorePath(),
			}),
		};
		const service = createService(storage);

		const result = await service.createSession('Security pass');

		assert.deepStrictEqual(result, {
			status: 'blocked',
			reason: 'invalidStore',
			message: 'The annotation store is invalid. Fix the store file before retrying.',
			storePath: storage.getStorePath(),
			error: invalidError,
			latestState: {
				status: 'invalid',
				storePath: storage.getStorePath(),
				error: invalidError,
			},
		});
		assert.deepStrictEqual(service.getState(), {
			status: 'invalid',
			storePath: storage.getStorePath(),
			error: invalidError,
		});
	});

	// Scenario: a mutation save conflict refreshes from disk and returns the latest ready state instead of stale in-memory data.
	test('returns storeConflict with refreshed latest state when persisting a mutation conflicts', async () => {
		const refreshedStore = createStore({
			activeSessionId: 'session-2',
			sessions: [
				createSession('session-1', [createAnnotation('annotation-1', 'active')], '2026-05-20T10:00:00.000Z'),
				createSession('session-2', [createAnnotation('annotation-2', 'resolved')], '2026-05-20T13:00:00.000Z'),
			],
		});
		const baseStorage = new InMemoryStorageController(createStore({ activeSessionId: null, sessions: [] }));
		let loadCount = 0;
		const storage: TestStorageController = {
			getStorePath: () => baseStorage.getStorePath(),
			load: async () => {
				loadCount += 1;
				if (loadCount === 1) {
					return baseStorage.load();
				}

				baseStorage.store = structuredClone(refreshedStore);
				return {
					status: 'ready',
					store: structuredClone(baseStorage.store),
					version: createVersion('refreshed-store'),
					storePath: baseStorage.getStorePath(),
				};
			},
			save: async (_store: AnnotationStore) => ({
				status: 'conflict',
				storePath: baseStorage.getStorePath(),
			}),
		};
		const service = createService(storage);

		const result = await service.createSession('Security pass');

		assert.strictEqual(result.status, 'blocked');
		if (result.status !== 'blocked') {
			return;
		}

		assert.strictEqual(result.reason, 'storeConflict');
		assert.strictEqual(result.message, 'The annotation store changed on disk. Review the latest state and retry the command.');
		assert.strictEqual(result.latestState?.status, 'ready');
		if (result.latestState?.status !== 'ready') {
			return;
		}

		assert.strictEqual(result.latestState.projection.activeSessionId, 'session-2');
		assert.deepStrictEqual(result.latestState.projection.sessions.map((session) => session.sessionId), ['session-1', 'session-2']);
		assert.deepStrictEqual(service.getState(), result.latestState);
	});

	// Scenario: purging dismissed annotations only removes dismissed entries from the active session.
	test('purges dismissed annotations from the active session only', async () => {
		const storage = new InMemoryStorageController(
			createStore({
				activeSessionId: 'session-1',
				sessions: [
					createSession('session-1', [
						createAnnotation('annotation-1', 'active'),
						createAnnotation('annotation-2', 'dismissed'),
					]),
					createSession('session-2', [createAnnotation('annotation-3', 'dismissed')]),
				],
			}),
		);
		const service = createService(storage);

		const result = await service.purgeDismissedAnnotations();

		assert.strictEqual(result.status, 'ready');
		if (result.status !== 'ready') {
			return;
		}

		assert.strictEqual(result.purgedCount, 1);
		assert.deepStrictEqual(
			storage.store.sessions.map((session) => session.annotations.map((annotation) => annotation.annotationId)),
			[['annotation-1'], ['annotation-3']],
		);
	});

	// Scenario: Given the active review session, When deleteSession removes it, Then the most recently updated remaining session becomes active.
	test('deletes the active session and reassigns the active session to the most recently updated remaining session', async () => {
		const storage = new InMemoryStorageController(
			createStore({
				activeSessionId: 'session-1',
				sessions: [
					createSession('session-1', [createAnnotation('annotation-1', 'active')], '2026-05-20T10:00:00.000Z'),
					createSession('session-2', [createAnnotation('annotation-2', 'active')], '2026-05-20T11:00:00.000Z'),
					createSession('session-3', [createAnnotation('annotation-3', 'active')], '2026-05-20T12:00:00.000Z'),
				],
			}),
		);
		const service = createService(storage);

		const result = await service.deleteSession('session-1');

		assert.strictEqual(result.status, 'ready');
		if (result.status !== 'ready') {
			return;
		}

		assert.deepStrictEqual(storage.store.sessions.map((session) => session.sessionId), ['session-2', 'session-3']);
		assert.strictEqual(storage.store.activeSessionId, 'session-3');
	});

	// Scenario: Given a non-active review session, When deleteSession removes it, Then the active session stays unchanged.
	test('deletes a non-active session without changing the active session', async () => {
		const storage = new InMemoryStorageController(
			createStore({
				activeSessionId: 'session-1',
				sessions: [
					createSession('session-1', [createAnnotation('annotation-1', 'active')]),
					createSession('session-2', [createAnnotation('annotation-2', 'active')]),
				],
			}),
		);
		const service = createService(storage);

		const result = await service.deleteSession('session-2');

		assert.strictEqual(result.status, 'ready');
		if (result.status !== 'ready') {
			return;
		}

		assert.deepStrictEqual(storage.store.sessions.map((session) => session.sessionId), ['session-1']);
		assert.strictEqual(storage.store.activeSessionId, 'session-1');
	});

	// Scenario: Given a populated review session, When clearSessionAnnotations runs, Then only that session's annotations are removed and updatedAt is refreshed.
	test('clears annotations from a populated session and refreshes its updatedAt timestamp', async () => {
		const storage = new InMemoryStorageController(
			createStore({
				sessions: [
					createSession('session-1', [createAnnotation('annotation-1', 'active')]),
					createSession('session-2', [createAnnotation('annotation-2', 'dismissed')]),
				],
			}),
		);
		const service = createService(storage);

		const result = await service.clearSessionAnnotations('session-2');

		assert.strictEqual(result.status, 'ready');
		if (result.status !== 'ready') {
			return;
		}

		assert.deepStrictEqual(storage.store.sessions[0]?.annotations.map((annotation) => annotation.annotationId), ['annotation-1']);
		assert.deepStrictEqual(storage.store.sessions[1]?.annotations, []);
		assert.strictEqual(storage.store.sessions[1]?.updatedAt, '2026-05-20T12:00:00.000Z');
	});

	// Scenario: Given an unknown review session, When deleteSession or clearSessionAnnotations runs, Then the mutation is blocked with sessionNotFound.
	test('blocks deleteSession and clearSessionAnnotations when the session is unknown', async () => {
		const storage = new InMemoryStorageController(createStore());
		const service = createService(storage);

		const deleteResult = await service.deleteSession('missing-session');
		const clearResult = await service.clearSessionAnnotations('missing-session');

		assert.deepStrictEqual(deleteResult, {
			status: 'blocked',
			reason: 'sessionNotFound',
			message: 'The selected review session could not be found.',
			storePath: storage.getStorePath(),
			error: undefined,
			latestState: undefined,
		});
		assert.deepStrictEqual(clearResult, {
			status: 'blocked',
			reason: 'sessionNotFound',
			message: 'The selected review session could not be found.',
			storePath: storage.getStorePath(),
			error: undefined,
			latestState: undefined,
		});
	});

	// Scenario: Given a remaining session list becomes empty, When deleteSession removes the final active session, Then the workspace clears the active session id.
	test('deletes the final session and clears the active session id', async () => {
		const storage = new InMemoryStorageController(
			createStore({
				activeSessionId: 'session-1',
				sessions: [createSession('session-1', [createAnnotation('annotation-1', 'active')])],
			}),
		);
		const service = createService(storage);

		const result = await service.deleteSession('session-1');

		assert.strictEqual(result.status, 'ready');
		if (result.status !== 'ready') {
			return;
		}

		assert.strictEqual(result.sessionId, undefined);
		assert.strictEqual(storage.store.activeSessionId, null);
		assert.deepStrictEqual(storage.store.sessions, []);
	});

	// Scenario: Given multiple review sessions, When setActiveSession selects a known session, Then that session becomes active and unknown ids remain blocked.
	test('sets the active session for known ids and blocks unknown ids', async () => {
		const storage = new InMemoryStorageController(
			createStore({
				activeSessionId: 'session-1',
				sessions: [
					createSession('session-1', [createAnnotation('annotation-1', 'active')]),
					createSession('session-2', [createAnnotation('annotation-2', 'active')]),
				],
			}),
		);
		const service = createService(storage);

		const readyResult = await service.setActiveSession('session-2');
		const blockedResult = await service.setActiveSession('missing-session');

		assert.strictEqual(readyResult.status, 'ready');
		if (readyResult.status !== 'ready') {
			return;
		}

		assert.strictEqual(readyResult.sessionId, 'session-2');
		assert.strictEqual(storage.store.activeSessionId, 'session-2');
		assert.deepStrictEqual(blockedResult, {
			status: 'blocked',
			reason: 'sessionNotFound',
			message: 'The selected review session could not be found.',
			storePath: storage.getStorePath(),
			error: undefined,
			latestState: undefined,
		});
	});

	// Scenario: Given an existing annotation, When updateAnnotation and dismissAnnotation run, Then the body, status, and timestamps are persisted on the matching entry only.
	test('updates and dismisses an existing annotation', async () => {
		const storage = new InMemoryStorageController(createStore());
		const service = createService(storage);

		const updateResult = await service.updateAnnotation({
			annotationId: 'annotation-1',
			body: 'Updated review guidance.',
		});
		const dismissResult = await service.dismissAnnotation('annotation-1');

		assert.strictEqual(updateResult.status, 'ready');
		assert.strictEqual(dismissResult.status, 'ready');
		assert.strictEqual(storage.store.sessions[0]?.annotations[0]?.body, 'Updated review guidance.');
		assert.strictEqual(storage.store.sessions[0]?.annotations[0]?.status, 'dismissed');
		assert.strictEqual(storage.store.sessions[0]?.annotations[0]?.updatedAt, '2026-05-20T12:00:00.000Z');
	});

	// Scenario: Given no matching annotation exists, When updateAnnotation or dismissAnnotation runs, Then both commands are blocked with annotationNotFound.
	test('blocks updateAnnotation and dismissAnnotation when the annotation is unknown', async () => {
		const storage = new InMemoryStorageController(createStore());
		const service = createService(storage);

		const updateResult = await service.updateAnnotation({
			annotationId: 'missing-annotation',
			body: 'Updated review guidance.',
		});
		const dismissResult = await service.dismissAnnotation('missing-annotation');

		assert.deepStrictEqual(updateResult, {
			status: 'blocked',
			reason: 'annotationNotFound',
			message: 'The selected annotation could not be found.',
			storePath: storage.getStorePath(),
			error: undefined,
			latestState: undefined,
		});
		assert.deepStrictEqual(dismissResult, {
			status: 'blocked',
			reason: 'annotationNotFound',
			message: 'The selected annotation could not be found.',
			storePath: storage.getStorePath(),
			error: undefined,
			latestState: undefined,
		});
	});

	// Scenario: Given no active session is selected, When purging dismissed annotations, Then the command is blocked before mutating the store.
	test('blocks purgeDismissedAnnotations without an active session', async () => {
		const storage = new InMemoryStorageController(createStore({ activeSessionId: null, sessions: [] }));
		const service = createService(storage);

		const result = await service.purgeDismissedAnnotations();

		assert.deepStrictEqual(result, {
			status: 'blocked',
			reason: 'noActiveSession',
			message: 'Select a review session before purging dismissed annotations.',
			storePath: storage.getStorePath(),
			error: undefined,
			latestState: undefined,
		});
	});

	// Scenario: reanchor rejects traversal input before any filesystem read can escape the workspace.
	test('blocks reanchor traversal before reading the target file', async () => {
		const storage = new InMemoryStorageController(createStore());
		let readCount = 0;
		const service = createService(storage, {
			readFile: async () => {
				readCount += 1;
				return 'target()';
			},
		});

		const result = await service.reanchorAnnotation({
			annotationId: 'annotation-1',
			filePath: '../outside.ts',
			anchor: createAnchor(),
		});

		assert.strictEqual(result.status, 'blocked');
		if (result.status !== 'blocked') {
			return;
		}

		assert.strictEqual(result.reason, 'fileMissing');
		assert.strictEqual(readCount, 0);
	});

	// Scenario: Given a nearby edited match, When reanchorAnnotation succeeds, Then the persisted anchor range is replaced with the matcher result instead of the raw editor selection.
	test('reanchorAnnotation persists the matched anchor range from the reanchor matcher', async () => {
		const storage = new InMemoryStorageController(createStore());
		const service = createService(storage, {
			readFile: async () => ['before a', 'before b', 'targeted', 'after a', 'after b'].join('\n'),
		});

		const result = await service.reanchorAnnotation({
			annotationId: 'annotation-1',
			filePath: 'src/extension.ts',
			anchor: createAnchor(),
		});

		assert.strictEqual(result.status, 'ready');
		if (result.status !== 'ready') {
			return;
		}

		assert.deepStrictEqual(result.reanchored, {
			range: {
				start: { line: 2, character: 0 },
				end: { line: 2, character: 8 },
			},
			strategy: 'fingerprint',
			contextScore: 4,
			contextScoreMax: 4,
		});
		assert.deepStrictEqual(storage.store.sessions[0]?.annotations[0]?.anchor.range, {
			start: { line: 2, character: 0 },
			end: { line: 2, character: 8 },
		});
		assert.strictEqual(storage.store.sessions[0]?.annotations[0]?.anchorState, 'anchored');
	});

	// Scenario: Given a target file read fails, When reanchorAnnotation runs, Then it returns fileMissing with the read error.
	test('reanchorAnnotation blocks when the target file cannot be read', async () => {
		const storage = new InMemoryStorageController(createStore());
		const readError = new Error('ENOENT');
		const service = createService(storage, {
			readFile: async () => {
				throw readError;
			},
		});

		const result = await service.reanchorAnnotation({
			annotationId: 'annotation-1',
			filePath: 'src/extension.ts',
			anchor: createAnchor(),
		});

		assert.deepStrictEqual(result, {
			status: 'blocked',
			reason: 'fileMissing',
			message: 'The target file could not be read for reanchoring.',
			storePath: storage.getStorePath(),
			error: readError,
			latestState: undefined,
		});
	});

	// Scenario: Given no nearby match exists, When reanchorAnnotation runs, Then the annotation is kept with the requested anchor and marked orphaned.
	test('reanchorAnnotation marks annotations orphaned when no nearby match is found', async () => {
		const storage = new InMemoryStorageController(createStore());
		const fallbackAnchor = createAnnotationAnchor(
			{
				start: { line: 8, character: 1 },
				end: { line: 8, character: 9 },
			},
			'missing()',
			['before x', 'before y'],
			['after x', 'after y'],
		);
		const service = createService(storage, {
			readFile: async () => ['alpha', 'beta', 'gamma', 'delta'].join('\n'),
		});

		const result = await service.reanchorAnnotation({
			annotationId: 'annotation-1',
			filePath: 'src\\extension.ts',
			anchor: fallbackAnchor,
		});

		assert.strictEqual(result.status, 'ready');
		if (result.status !== 'ready') {
			return;
		}

		assert.strictEqual(result.reanchored, undefined);
		assert.strictEqual(storage.store.sessions[0]?.annotations[0]?.anchorState, 'orphaned');
		assert.strictEqual(storage.store.sessions[0]?.annotations[0]?.filePath, 'src/extension.ts');
		assert.deepStrictEqual(storage.store.sessions[0]?.annotations[0]?.anchor.range, fallbackAnchor.range);
	});

	// Scenario: Given workspace annotations are available, When draft output and range lookup are requested, Then the ready projection and normalized range match are returned.
	test('returns draft output and finds annotations by normalized path and range', async () => {
		const storage = new InMemoryStorageController(createStore());
		const service = createService(storage);

		const draftResult = await service.generateDraftOutput();
		const annotation = await service.findAnnotationAtRange('src\\extension.ts', createAnchor().range);

		assert.strictEqual(draftResult.status, 'ready');
		if (draftResult.status !== 'ready') {
			return;
		}

		assert.strictEqual(draftResult.projection.activeSessionId, 'session-1');
		assert.strictEqual(annotation?.annotationId, 'annotation-1');
	});

	// Scenario: Given the workspace store is invalid, When draft output or range lookup is requested, Then the draft call is blocked and the lookup returns undefined.
	test('blocks draft output and returns undefined range matches when the store is invalid', async () => {
		const invalidError = createAnnotationValidationError('$.activeSessionId', 'activeSessionId must reference a session.');
		const storage = new InvalidStorageController(invalidError);
		const service = createService(storage);

		const draftResult = await service.generateDraftOutput();
		const annotation = await service.findAnnotationAtRange('src/extension.ts', createAnchor().range);

		assert.deepStrictEqual(draftResult, {
			status: 'blocked',
			reason: 'invalidStore',
			message: 'The annotation store is invalid. Fix the store file before running annotation commands.',
			storePath: storage.getStorePath(),
			error: invalidError,
			latestState: {
				status: 'invalid',
				storePath: storage.getStorePath(),
				error: invalidError,
			},
		});
		assert.strictEqual(annotation, undefined);
	});

	// Scenario: Given an active annotation, When resolveAnnotation is called, Then status is 'resolved' and updatedAt is refreshed.
	test('resolveAnnotation sets annotation status to resolved', async () => {
		const storage = new InMemoryStorageController(
			createStore({
				sessions: [createSession('session-1', [createAnnotation('annotation-1', 'active')])],
			}),
		);
		const service = createService(storage);

		const result = await service.resolveAnnotation('annotation-1');

		assert.strictEqual(result.status, 'ready');
		if (result.status !== 'ready') {
			return;
		}

		assert.strictEqual(storage.store.sessions[0]?.annotations[0]?.status, 'resolved');
		assert.strictEqual(storage.store.sessions[0]?.annotations[0]?.updatedAt, '2026-05-20T12:00:00.000Z');
	});

	// Scenario: Given a resolved annotation, When resolveAnnotation is called, Then it blocks the invalid lifecycle transition.
	test('resolveAnnotation blocks already resolved annotations', async () => {
		const storage = new InMemoryStorageController(
			createStore({
				sessions: [createSession('session-1', [createAnnotation('annotation-1', 'resolved')])],
			}),
		);
		const service = createService(storage);

		const result = await service.resolveAnnotation('annotation-1');

		assert.deepStrictEqual(result, {
			status: 'blocked',
			reason: 'invalidAnnotationStatus',
			message: 'Only active annotations can be resolved.',
			storePath: storage.getStorePath(),
			error: undefined,
			latestState: undefined,
		});
		assert.strictEqual(storage.store.sessions[0]?.annotations[0]?.status, 'resolved');
	});

	// Scenario: Given a dismissed annotation, When resolveAnnotation is called, Then it blocks the invalid lifecycle transition.
	test('resolveAnnotation blocks dismissed annotations', async () => {
		const storage = new InMemoryStorageController(
			createStore({
				sessions: [createSession('session-1', [createAnnotation('annotation-1', 'dismissed')])],
			}),
		);
		const service = createService(storage);

		const result = await service.resolveAnnotation('annotation-1');

		assert.deepStrictEqual(result, {
			status: 'blocked',
			reason: 'invalidAnnotationStatus',
			message: 'Only active annotations can be resolved.',
			storePath: storage.getStorePath(),
			error: undefined,
			latestState: undefined,
		});
		assert.strictEqual(storage.store.sessions[0]?.annotations[0]?.status, 'dismissed');
	});

	// Scenario: Given a store with no matching annotation, When resolveAnnotation is called with an unknown ID, Then it returns blocked with annotationNotFound.
	test('resolveAnnotation returns blocked when annotation is not found', async () => {
		const storage = new InMemoryStorageController(createStore());
		const service = createService(storage);

		const result = await service.resolveAnnotation('nonexistent-id');

		assert.deepStrictEqual(result, {
			status: 'blocked',
			reason: 'annotationNotFound',
			message: 'The selected annotation could not be found.',
			storePath: storage.getStorePath(),
			error: undefined,
			latestState: undefined,
		});
	});

	// Scenario: Given a resolved annotation, When reopenAnnotation is called, Then status is 'active' and updatedAt is refreshed.
	test('reopenAnnotation sets annotation status to active', async () => {
		const storage = new InMemoryStorageController(
			createStore({
				sessions: [createSession('session-1', [createAnnotation('annotation-1', 'resolved')])],
			}),
		);
		const service = createService(storage);

		const result = await service.reopenAnnotation('annotation-1');

		assert.strictEqual(result.status, 'ready');
		if (result.status !== 'ready') {
			return;
		}

		assert.strictEqual(storage.store.sessions[0]?.annotations[0]?.status, 'active');
		assert.strictEqual(storage.store.sessions[0]?.annotations[0]?.updatedAt, '2026-05-20T12:00:00.000Z');
	});

	// Scenario: Given an active annotation, When reopenAnnotation is called, Then it blocks the invalid lifecycle transition.
	test('reopenAnnotation blocks already active annotations', async () => {
		const storage = new InMemoryStorageController(
			createStore({
				sessions: [createSession('session-1', [createAnnotation('annotation-1', 'active')])],
			}),
		);
		const service = createService(storage);

		const result = await service.reopenAnnotation('annotation-1');

		assert.deepStrictEqual(result, {
			status: 'blocked',
			reason: 'invalidAnnotationStatus',
			message: 'Only resolved annotations can be reopened.',
			storePath: storage.getStorePath(),
			error: undefined,
			latestState: undefined,
		});
		assert.strictEqual(storage.store.sessions[0]?.annotations[0]?.status, 'active');
	});

	// Scenario: Given a dismissed annotation, When reopenAnnotation is called, Then it blocks the invalid lifecycle transition.
	test('reopenAnnotation blocks dismissed annotations', async () => {
		const storage = new InMemoryStorageController(
			createStore({
				sessions: [createSession('session-1', [createAnnotation('annotation-1', 'dismissed')])],
			}),
		);
		const service = createService(storage);

		const result = await service.reopenAnnotation('annotation-1');

		assert.deepStrictEqual(result, {
			status: 'blocked',
			reason: 'invalidAnnotationStatus',
			message: 'Only resolved annotations can be reopened.',
			storePath: storage.getStorePath(),
			error: undefined,
			latestState: undefined,
		});
		assert.strictEqual(storage.store.sessions[0]?.annotations[0]?.status, 'dismissed');
	});

	// Scenario: Given a store with no matching annotation, When reopenAnnotation is called with an unknown ID, Then it returns blocked with annotationNotFound.
	test('reopenAnnotation returns blocked when annotation is not found', async () => {
		const storage = new InMemoryStorageController(createStore());
		const service = createService(storage);

		const result = await service.reopenAnnotation('nonexistent-id');

		assert.deepStrictEqual(result, {
			status: 'blocked',
			reason: 'annotationNotFound',
			message: 'The selected annotation could not be found.',
			storePath: storage.getStorePath(),
			error: undefined,
			latestState: undefined,
		});
	});
});

function createService(
	storage: TestStorageController,
	dependencies: Partial<AnnotationWorkspaceDependencies> | AnnotationWorkspaceFileReader = {},
): AnnotationWorkspaceService {
	const fileReader = 'readFile' in dependencies
		? dependencies
		: dependencies.fileReader;
	const resolvedDependencies = 'readFile' in dependencies
		? {}
		: dependencies;

	return new AnnotationWorkspaceService(
		createWorkspaceFolder(),
		{
			storage,
			fileReader: fileReader ?? {
				readFile: async () => ['before a', 'before b', 'target()', 'after a', 'after b'].join('\n'),
			},
			watcherFactory: resolvedDependencies.watcherFactory ?? (() => ({ dispose() {} })),
			clock: resolvedDependencies.clock ?? (() => new Date('2026-05-20T12:00:00.000Z')),
			idFactory: resolvedDependencies.idFactory ?? (() => 'generated-id'),
			logger: resolvedDependencies.logger,
		},
	);
}

function createWorkspaceFolder(): AnnotationWorkspaceFolder {
	return {
		uri: {
			fsPath: 'e:/source/ai-toolkit',
		},
	};
}

function createStore(overrides: Partial<AnnotationStore> = {}): AnnotationStore {
	return {
		schemaVersion: annotationSchemaVersion,
		activeSessionId: 'session-1',
		sessions: [createSession('session-1', [createAnnotation('annotation-1', 'active')])],
		...overrides,
	};
}

function createSession(
	sessionId: string,
	annotations = [createAnnotation('annotation-1', 'active')],
	updatedAt = '2026-05-20T10:00:00.000Z',
) {
	return {
		sessionId,
		name: `Session ${sessionId}`,
		sessionSlug: `session-${sessionId}`,
		createdAt: '2026-05-20T10:00:00.000Z',
		updatedAt,
		annotations,
	};
}

function createAnnotation(annotationId: string, status: 'active' | 'dismissed' | 'resolved') {
	return {
		annotationId,
		status,
		anchorState: 'anchored' as const,
		body: `Body for ${annotationId}`,
		filePath: 'src/extension.ts',
		createdAt: '2026-05-20T10:05:00.000Z',
		updatedAt: '2026-05-20T10:05:00.000Z',
		anchor: createAnchor(),
	};
}

function createAnchor() {
	return createAnnotationAnchor(
		{
			start: { line: 2, character: 0 },
			end: { line: 2, character: 8 },
		},
		'target()',
		['before a', 'before b'],
		['after a', 'after b'],
	);
}

function createLoggerSpy() {
	return {
		errors: [] as Array<{ message: string; details?: Record<string, unknown> }>,
		info() {},
		warn() {},
		error(message: string, details?: Record<string, unknown>) {
			this.errors.push({ message, details });
		},
	};
}

async function flushAsyncWork(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

class InMemoryStorageController {
	public store: AnnotationStore;
	private version: PersistedAnnotationStoreVersion;

	public constructor(initialStore: AnnotationStore) {
		this.store = structuredClone(initialStore);
		this.version = createVersion('seed');
	}

	public getStorePath(): string {
		return 'e:/source/ai-toolkit/.vscode/ai-toolkit.annotations.json';
	}

	public async load() {
		return {
			status: 'ready' as const,
			store: structuredClone(this.store),
			version: this.version,
			storePath: this.getStorePath(),
		};
	}

	public async save(store: AnnotationStore) {
		this.store = structuredClone(store);
		this.version = createVersion(JSON.stringify(store));
		return {
			status: 'saved' as const,
			store: structuredClone(store),
			version: this.version,
			storePath: this.getStorePath(),
		};
	}
	}

class InvalidStorageController {
	public constructor(private readonly error: AnnotationStoreValidationError) {}

	public getStorePath(): string {
		return 'e:/source/ai-toolkit/.vscode/ai-toolkit.annotations.json';
	}

	public async load() {
		return {
			status: 'invalid' as const,
			error: this.error,
			storePath: this.getStorePath(),
		};
	}

	public async save(): Promise<AnnotationSaveResult> {
		throw new Error('save should not be called when load is invalid');
	}
	}

function createVersion(seed: string): PersistedAnnotationStoreVersion {
	return {
		mtimeMs: 1,
		size: seed.length,
		contentHash: seed,
		fingerprint: seed,
	};
}