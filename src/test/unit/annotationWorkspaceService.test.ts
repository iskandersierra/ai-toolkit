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
	type AnnotationWorkspaceFileReader,
	type AnnotationWorkspaceFolder,
} from '../../annotations/application/annotationWorkspaceService';
import type { AnnotationSaveResult } from '../../annotations/infrastructure/annotationStorageController';

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
		assert.strictEqual(storage.store.activeSessionId, result.sessionId);
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
	storage: InMemoryStorageController | InvalidStorageController,
	fileReader: AnnotationWorkspaceFileReader = {
		readFile: async () => ['before a', 'before b', 'target()', 'after a', 'after b'].join('\n'),
	},
): AnnotationWorkspaceService {
	return new AnnotationWorkspaceService(
		createWorkspaceFolder(),
		{
			storage,
			fileReader,
			watcherFactory: () => ({ dispose() {} }),
			clock: () => new Date('2026-05-20T12:00:00.000Z'),
			idFactory: () => 'generated-id',
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