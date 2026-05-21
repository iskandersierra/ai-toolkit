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

function createSession(sessionId: string, annotations = [createAnnotation('annotation-1', 'active')]) {
	return {
		sessionId,
		name: `Session ${sessionId}`,
		sessionSlug: `session-${sessionId}`,
		createdAt: '2026-05-20T10:00:00.000Z',
		updatedAt: '2026-05-20T10:00:00.000Z',
		annotations,
	};
}

function createAnnotation(annotationId: string, status: 'active' | 'dismissed') {
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