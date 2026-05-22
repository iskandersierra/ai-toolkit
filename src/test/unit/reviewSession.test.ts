import * as assert from 'assert';
import { deriveAnnotationWorkspaceProjection } from '../../annotations/application/projectionModel';
import {
	SessionSelectionService,
} from '../../annotations/application/sessionSelectionService';
import type {
	AnnotationWorkspaceMutationResult,
	AnnotationWorkspaceServiceLike,
	AnnotationWorkspaceState,
	CreateAnnotationInput,
	ReanchorAnnotationInput,
	UpdateAnnotationInput,
} from '../../annotations/application/annotationWorkspaceService';
import {
	annotationSchemaVersion,
	type AnnotationStore,
} from '../../annotations/domain/annotationModels';

suite('Review Session', () => {
	// Scenario: Given zero review sessions, When ensureActiveSession runs, Then it auto-creates Review Session without opening the picker.
	test('auto-creates the first review session when none exist', async () => {
		let pickSessionCount = 0;
		const service = new FakeSessionWorkspaceService(createStore({ activeSessionId: null, sessions: [] }));
		const selectionService = new SessionSelectionService({
			pickSession: async () => {
				pickSessionCount += 1;
				return undefined;
			},
			promptForNewSessionName: async () => undefined,
		});

		const result = await selectionService.ensureActiveSession(service);

		assert.deepStrictEqual(result, {
			status: 'ready',
			sessionId: 'session-1',
			created: true,
			projection: deriveAnnotationWorkspaceProjection(workspaceFolderPath, service.store),
		});
		assert.strictEqual(service.store.sessions[0]?.name, 'Review Session');
		assert.strictEqual(service.store.activeSessionId, 'session-1');
		assert.strictEqual(pickSessionCount, 0);
	});

	// Scenario: Given existing sessions with no active one, When ensureActiveSession runs, Then it falls back to the picker instead of auto-creating a new session.
	test('falls back to the picker when sessions exist but none is active', async () => {
		let pickSessionCount = 0;
		const service = new FakeSessionWorkspaceService(
			createStore({
				activeSessionId: null,
				sessions: [createSession('session-1', 'Security pass'), createSession('session-2', 'Review Session 3')],
			}),
		);
		const selectionService = new SessionSelectionService({
			pickSession: async (items) => {
				pickSessionCount += 1;
				return items[0];
			},
			promptForNewSessionName: async () => undefined,
		});

		const result = await selectionService.ensureActiveSession(service);

		assert.deepStrictEqual(result, {
			status: 'ready',
			sessionId: 'session-1',
			created: false,
			projection: deriveAnnotationWorkspaceProjection(workspaceFolderPath, service.store),
		});
		assert.strictEqual(service.store.sessions.length, 2);
		assert.strictEqual(service.store.activeSessionId, 'session-1');
		assert.strictEqual(pickSessionCount, 1);
	});

	// Scenario: Given matching and custom session names, When the next default name is requested, Then it increments from the highest matching Review Session sequence and preserves gaps.
	test('computes the next default review session name from matching sessions only', () => {
		const selectionService = new SessionSelectionService({
			pickSession: async () => undefined,
			promptForNewSessionName: async () => undefined,
		});

		const nextName = selectionService.getNextDefaultSessionName(
			deriveAnnotationWorkspaceProjection(
				workspaceFolderPath,
				createStore({
					activeSessionId: null,
					sessions: [
						createSession('session-1', 'Review Session'),
						createSession('session-2', 'Security pass'),
						createSession('session-3', 'Review Session 2'),
						createSession('session-4', 'Review Session 4'),
						createSession('session-5', 'review session 10'),
					],
				}),
			),
		);

		assert.strictEqual(nextName, 'Review Session 5');
	});
});

const workspaceFolderPath = 'e:/source/ai-toolkit';
const storePath = 'e:/source/ai-toolkit/.vscode/ai-toolkit.annotations.json';

function createStore(overrides: Partial<AnnotationStore> = {}): AnnotationStore {
	return {
		schemaVersion: annotationSchemaVersion,
		activeSessionId: 'session-1',
		sessions: [createSession('session-1', 'Review Session')],
		...overrides,
	};
}

function createSession(sessionId: string, name: string) {
	return {
		sessionId,
		name,
		sessionSlug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
		createdAt: '2026-05-20T10:00:00.000Z',
		updatedAt: '2026-05-20T10:00:00.000Z',
		annotations: [],
	};
}

class FakeSessionWorkspaceService implements AnnotationWorkspaceServiceLike {
	public constructor(public store: AnnotationStore) {}

	public getState(): AnnotationWorkspaceState {
		return {
			status: 'ready',
			projection: deriveAnnotationWorkspaceProjection(workspaceFolderPath, this.store),
			storePath,
		};
	}

	public async initialize(): Promise<AnnotationWorkspaceState> {
		return this.getState();
	}

	public async createSession(name: string): Promise<AnnotationWorkspaceMutationResult> {
		const sessionId = `session-${this.store.sessions.length + 1}`;
		this.store.sessions.push(createSession(sessionId, name));
		this.store.activeSessionId = sessionId;
		return {
			status: 'ready',
			projection: deriveAnnotationWorkspaceProjection(workspaceFolderPath, this.store),
			storePath,
			sessionId,
		};
	}

	public async setActiveSession(sessionId: string): Promise<AnnotationWorkspaceMutationResult> {
		this.store.activeSessionId = sessionId;
		return {
			status: 'ready',
			projection: deriveAnnotationWorkspaceProjection(workspaceFolderPath, this.store),
			storePath,
			sessionId,
		};
	}

	public async deleteSession(_sessionId: string): Promise<AnnotationWorkspaceMutationResult> {
		throw new Error('Not implemented.');
	}

	public async clearSessionAnnotations(_sessionId: string): Promise<AnnotationWorkspaceMutationResult> {
		throw new Error('Not implemented.');
	}

	public async createAnnotation(_input: CreateAnnotationInput): Promise<AnnotationWorkspaceMutationResult> {
		throw new Error('Not implemented.');
	}

	public async updateAnnotation(_input: UpdateAnnotationInput): Promise<AnnotationWorkspaceMutationResult> {
		throw new Error('Not implemented.');
	}

	public async dismissAnnotation(_annotationId: string): Promise<AnnotationWorkspaceMutationResult> {
		throw new Error('Not implemented.');
	}

	public async resolveAnnotation(_annotationId: string): Promise<AnnotationWorkspaceMutationResult> {
		throw new Error('Not implemented.');
	}

	public async reopenAnnotation(_annotationId: string): Promise<AnnotationWorkspaceMutationResult> {
		throw new Error('Not implemented.');
	}

	public async purgeDismissedAnnotations(): Promise<AnnotationWorkspaceMutationResult> {
		throw new Error('Not implemented.');
	}

	public async reanchorAnnotation(_input: ReanchorAnnotationInput): Promise<AnnotationWorkspaceMutationResult> {
		throw new Error('Not implemented.');
	}

	public async generateDraftOutput(): Promise<AnnotationWorkspaceMutationResult> {
		throw new Error('Not implemented.');
	}
}