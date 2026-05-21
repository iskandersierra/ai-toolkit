import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {
	findAnnotationReanchorMatch,
	type AnnotationReanchorMatch,
} from '../domain/anchorMatching';
import type { AnnotationAnchor, AnnotationEntry, AnnotationSession, AnnotationStore } from '../domain/annotationModels';
import { validateRelativeFilePath } from '../domain/annotationValidation';
import type {
	AnnotationLoadResult,
	AnnotationLoadReadyResult,
	AnnotationSaveResult,
	AnnotationStorageController,
} from '../infrastructure/annotationStorageController';
import { createAnnotationLogger, type AnnotationLogger } from '../util/log';
import {
	deriveAnnotationWorkspaceProjection,
	type AnnotationProjectionEntry,
	type AnnotationWorkspaceProjection,
} from './projectionModel';

type AnnotationStorage = Pick<AnnotationStorageController, 'getStorePath' | 'load' | 'save'>;

export interface AnnotationWorkspaceFileReader {
	readFile(filePath: string): Promise<string>;
}

export interface AnnotationWorkspaceDependencies {
	storage: AnnotationStorage;
	fileReader?: AnnotationWorkspaceFileReader;
	watcherFactory?: AnnotationWorkspaceWatcherFactory;
	clock?: () => Date;
	idFactory?: () => string;
	logger?: AnnotationLogger;
}

export interface AnnotationWorkspaceFolder {
	uri: {
		fsPath: string;
	};
}

export interface AnnotationDisposable {
	dispose(): void;
}

export type AnnotationWorkspaceWatcherFactory = (
	workspaceFolder: AnnotationWorkspaceFolder,
	onChange: () => void,
	logger?: AnnotationLogger,
) => AnnotationDisposable;

export interface AnnotationWorkspaceReadyState {
	status: 'ready';
	projection: AnnotationWorkspaceProjection;
	storePath: string;
}

export interface AnnotationWorkspaceInvalidState {
	status: 'invalid';
	storePath: string;
	error: Error;
}

export type AnnotationWorkspaceState = AnnotationWorkspaceReadyState | AnnotationWorkspaceInvalidState;

export type AnnotationWorkspaceBlockedReason =
	| 'invalidStore'
	| 'noActiveSession'
	| 'sessionNotFound'
	| 'annotationNotFound'
	| 'storeConflict'
	| 'fileMissing';

export interface AnnotationWorkspaceBlockedResult {
	status: 'blocked';
	reason: AnnotationWorkspaceBlockedReason;
	message: string;
	storePath: string;
	error?: Error;
	latestState?: AnnotationWorkspaceState;
}

export interface AnnotationWorkspaceMutationSuccess {
	status: 'ready';
	projection: AnnotationWorkspaceProjection;
	storePath: string;
	annotation?: AnnotationProjectionEntry;
	sessionId?: string;
	reanchored?: AnnotationReanchorMatch;
	purgedCount?: number;
}

export type AnnotationWorkspaceMutationResult =
	| AnnotationWorkspaceMutationSuccess
	| AnnotationWorkspaceBlockedResult;

export interface AnnotationWorkspaceServiceLike {
	getState(): AnnotationWorkspaceState | undefined;
	initialize(): Promise<AnnotationWorkspaceState>;
	createSession(name: string): Promise<AnnotationWorkspaceMutationResult>;
	setActiveSession(sessionId: string): Promise<AnnotationWorkspaceMutationResult>;
	createAnnotation(input: CreateAnnotationInput): Promise<AnnotationWorkspaceMutationResult>;
	updateAnnotation(input: UpdateAnnotationInput): Promise<AnnotationWorkspaceMutationResult>;
	dismissAnnotation(annotationId: string): Promise<AnnotationWorkspaceMutationResult>;
	purgeDismissedAnnotations(): Promise<AnnotationWorkspaceMutationResult>;
	reanchorAnnotation(input: ReanchorAnnotationInput): Promise<AnnotationWorkspaceMutationResult>;
	generateDraftOutput(): Promise<AnnotationWorkspaceMutationResult>;
}

export interface CreateAnnotationInput {
	body: string;
	filePath: string;
	anchor: AnnotationAnchor;
	annotationId?: string;
}

export interface UpdateAnnotationInput {
	annotationId: string;
	body: string;
}

export interface ReanchorAnnotationInput {
	annotationId: string;
	filePath: string;
	anchor: AnnotationAnchor;
}

type AnnotationWorkspaceMutationPlan = {
	store: AnnotationStore;
	annotationId?: string;
	sessionId?: string;
	reanchored?: AnnotationReanchorMatch;
	purgedCount?: number;
};

type ReadyStoreState = {
	kind: 'ready';
	store: AnnotationStore;
	storePath: string;
	version?: AnnotationLoadReadyResult['version'];
	projection: AnnotationWorkspaceProjection;
};

type InvalidStoreState = {
	kind: 'invalid';
	storePath: string;
	error: Error;
};

type StoreState = ReadyStoreState | InvalidStoreState;

export class AnnotationWorkspaceService implements AnnotationWorkspaceServiceLike {
	private readonly stateListeners = new Set<(state: AnnotationWorkspaceState) => void>();
	private readonly storage: AnnotationStorage;
	private readonly fileReader: AnnotationWorkspaceFileReader;
	private readonly watcherFactory: AnnotationWorkspaceWatcherFactory;
	private readonly clock: () => Date;
	private readonly idFactory: () => string;
	private readonly logger: AnnotationLogger;
	private readonly watcher: AnnotationDisposable;
	private state: StoreState | undefined;

	public constructor(
		private readonly workspaceFolder: AnnotationWorkspaceFolder,
		dependencies: AnnotationWorkspaceDependencies,
	) {
		this.storage = dependencies.storage;
		this.fileReader = dependencies.fileReader ?? createNodeAnnotationWorkspaceFileReader();
		this.watcherFactory = dependencies.watcherFactory ?? createNoopAnnotationWatcher;
		this.clock = dependencies.clock ?? (() => new Date());
		this.idFactory = dependencies.idFactory ?? createOpaqueId;
		this.logger = dependencies.logger ?? createAnnotationLogger();
		this.watcher = this.watcherFactory(this.workspaceFolder, () => {
			void this.refresh().catch((error: unknown) => {
				this.logger.error('Annotation workspace refresh failed after a store watcher update.', {
					storePath: this.storage.getStorePath(),
					error: error instanceof Error ? error.message : String(error),
				});
			});
		}, this.logger);
	}

	public dispose(): void {
		this.watcher.dispose();
		this.stateListeners.clear();
	}

	public onDidChangeState(listener: (state: AnnotationWorkspaceState) => void): AnnotationDisposable {
		this.stateListeners.add(listener);
		return {
			dispose: () => {
				this.stateListeners.delete(listener);
			},
		};
	}

	public async initialize(): Promise<AnnotationWorkspaceState> {
		return this.refresh();
	}

	public async refresh(): Promise<AnnotationWorkspaceState> {
		const loadResult = await this.storage.load();
		this.state = this.toStoreState(loadResult);
		const snapshot = this.toSnapshot(this.state);
		this.fireStateChanged(snapshot);
		return snapshot;
	}

	public getState(): AnnotationWorkspaceState | undefined {
		return this.state ? this.toSnapshot(this.state) : undefined;
	}

	public async createSession(name: string): Promise<AnnotationWorkspaceMutationResult> {
		return this.commit((store) => {
			const now = this.timestamp();
			const sessionId = this.idFactory();
			const session: AnnotationSession = {
				sessionId,
				name,
				sessionSlug: createSessionSlug(name),
				createdAt: now,
				updatedAt: now,
				annotations: [],
			};

			store.sessions.push(session);
			store.activeSessionId = sessionId;

			return { store, sessionId };
		});
	}

	public async setActiveSession(sessionId: string): Promise<AnnotationWorkspaceMutationResult> {
		return this.commit((store) => {
			const session = store.sessions.find((entry) => entry.sessionId === sessionId);

			if (!session) {
				return this.blocked('sessionNotFound', 'The selected review session could not be found.');
			}

			store.activeSessionId = sessionId;
			return { store, sessionId };
		});
	}

	public async createAnnotation(input: CreateAnnotationInput): Promise<AnnotationWorkspaceMutationResult> {
		return this.commit((store) => {
			const session = getActiveSession(store);

			if (!session) {
				return this.blocked('noActiveSession', 'Select a review session before creating an annotation.');
			}

			const now = this.timestamp();
			const entry: AnnotationEntry = {
				annotationId: input.annotationId ?? this.idFactory(),
				status: 'active',
				anchorState: 'anchored',
				body: input.body,
				filePath: normalizeRelativeFilePath(input.filePath),
				createdAt: now,
				updatedAt: now,
				anchor: input.anchor,
			};

			session.annotations.push(entry);
			session.updatedAt = now;

			return { store, annotationId: entry.annotationId };
		});
	}

	public async updateAnnotation(input: UpdateAnnotationInput): Promise<AnnotationWorkspaceMutationResult> {
		return this.commit((store) => {
			const located = findAnnotation(store, input.annotationId);

			if (!located) {
				return this.blocked('annotationNotFound', 'The selected annotation could not be found.');
			}

			const now = this.timestamp();
			located.annotation.body = input.body;
			located.annotation.updatedAt = now;
			located.session.updatedAt = now;

			return { store, annotationId: input.annotationId };
		});
	}

	public async dismissAnnotation(annotationId: string): Promise<AnnotationWorkspaceMutationResult> {
		return this.commit((store) => {
			const located = findAnnotation(store, annotationId);

			if (!located) {
				return this.blocked('annotationNotFound', 'The selected annotation could not be found.');
			}

			const now = this.timestamp();
			located.annotation.status = 'dismissed';
			located.annotation.updatedAt = now;
			located.session.updatedAt = now;

			return { store, annotationId };
		});
	}

	public async purgeDismissedAnnotations(): Promise<AnnotationWorkspaceMutationResult> {
		return this.commit((store) => {
			const session = getActiveSession(store);

			if (!session) {
				return this.blocked('noActiveSession', 'Select a review session before purging dismissed annotations.');
			}

			const originalCount = session.annotations.length;
			session.annotations = session.annotations.filter((annotation) => annotation.status !== 'dismissed');
			session.updatedAt = this.timestamp();

			return {
				store,
				purgedCount: originalCount - session.annotations.length,
			};
		}, { backupReason: 'purge' });
	}

	public async reanchorAnnotation(input: ReanchorAnnotationInput): Promise<AnnotationWorkspaceMutationResult> {
		const currentState = await this.ensureReadyState();

		if (isBlockedResult(currentState)) {
			return currentState;
		}

		const located = findAnnotation(currentState.store, input.annotationId);

		if (!located) {
			return this.blocked('annotationNotFound', 'The selected annotation could not be found.');
		}

		let normalizedPath: string;

		try {
			normalizedPath = normalizeAndValidateRelativeFilePath(input.filePath);
		} catch (error) {
			return this.blocked(
				'fileMissing',
				'The target file path is not a safe workspace-relative path.',
				error instanceof Error ? error : undefined,
			);
		}

		const absolutePath = path.join(this.workspaceFolder.uri.fsPath, normalizedPath);

		try {
			const documentText = await this.fileReader.readFile(absolutePath);
			const reanchored = findAnnotationReanchorMatch(documentText, input.anchor);

			return this.commit((store) => {
				const nextLocated = findAnnotation(store, input.annotationId);

				if (!nextLocated) {
					return this.blocked('annotationNotFound', 'The selected annotation could not be found.');
				}

				const now = this.timestamp();
				nextLocated.annotation.filePath = normalizedPath;
				nextLocated.annotation.anchor = input.anchor;
				nextLocated.annotation.anchorState = reanchored ? 'anchored' : 'orphaned';
				nextLocated.annotation.updatedAt = now;
				nextLocated.session.updatedAt = now;

				return {
					store,
					annotationId: input.annotationId,
					reanchored,
				};
			});
		} catch (error) {
			return this.blocked(
				'fileMissing',
				'The target file could not be read for reanchoring.',
				error instanceof Error ? error : undefined,
			);
		}
	}

	public async generateDraftOutput(): Promise<AnnotationWorkspaceMutationResult> {
		const readyState = await this.ensureReadyState();

		if (isBlockedResult(readyState)) {
			return readyState;
		}

		return {
			status: 'ready',
			projection: readyState.projection,
			storePath: readyState.storePath,
		};
	}

	public async findAnnotationAtRange(
		filePath: string,
		range: AnnotationAnchor['range'],
	): Promise<AnnotationProjectionEntry | undefined> {
		const readyState = await this.ensureReadyState();

		if (isBlockedResult(readyState)) {
			return undefined;
		}

		const normalizedPath = normalizeRelativeFilePath(filePath);
		return readyState.projection.annotations.find(
			(annotation) =>
				annotation.filePath === normalizedPath &&
				areRangesEqual(annotation.range, range),
		);
	}

	private async ensureReadyState(): Promise<ReadyStoreState | AnnotationWorkspaceBlockedResult> {
		if (!this.state) {
			await this.refresh();
		}

		if (!this.state) {
			return this.blocked('invalidStore', 'The annotation store could not be loaded.');
		}

		if (this.state.kind === 'invalid') {
			return this.blocked(
				'invalidStore',
				'The annotation store is invalid. Fix the store file before running annotation commands.',
				this.state.error,
				this.toSnapshot(this.state),
			);
		}

		return this.state;
	}

	private async commit(
		mutator: (store: AnnotationStore) => AnnotationWorkspaceBlockedResult | AnnotationWorkspaceMutationPlan,
		saveOptions?: { backupReason?: 'purge' },
	): Promise<AnnotationWorkspaceMutationResult> {
		const currentState = await this.ensureReadyState();

		if (isBlockedResult(currentState)) {
			return currentState;
		}

		const nextStore = structuredClone(currentState.store);
		const mutation = mutator(nextStore);

		if (isBlockedResult(mutation)) {
			return mutation;
		}

		const saveResult = await this.storage.save(
			mutation.store,
			currentState.version,
			saveOptions,
		);

		return this.handleSaveResult(saveResult, mutation.annotationId, mutation.sessionId, mutation.reanchored, mutation.purgedCount);
	}

	private async handleSaveResult(
		saveResult: AnnotationSaveResult,
		annotationId?: string,
		sessionId?: string,
		reanchored?: AnnotationReanchorMatch,
		purgedCount?: number,
	): Promise<AnnotationWorkspaceMutationResult> {
		if (saveResult.status === 'invalid') {
			const invalidState: InvalidStoreState = {
				kind: 'invalid',
				storePath: saveResult.storePath,
				error: saveResult.error,
			};
			this.state = invalidState;
			const snapshot = this.toSnapshot(invalidState);
			this.fireStateChanged(snapshot);
			return this.blocked(
				'invalidStore',
				'The annotation store is invalid. Fix the store file before retrying.',
				saveResult.error,
				snapshot,
			);
		}

		if (saveResult.status === 'conflict') {
			const latestState = await this.refresh();
			return this.blocked(
				'storeConflict',
				'The annotation store changed on disk. Review the latest state and retry the command.',
				undefined,
				latestState,
			);
		}

		const readyState: ReadyStoreState = {
			kind: 'ready',
			store: saveResult.store,
			storePath: saveResult.storePath,
			version: saveResult.version,
			projection: deriveAnnotationWorkspaceProjection(this.workspaceFolder.uri.fsPath, saveResult.store),
		};
		this.state = readyState;
		const snapshot = this.toSnapshot(readyState);
		this.fireStateChanged(snapshot);

		return {
			status: 'ready',
			projection: readyState.projection,
			storePath: readyState.storePath,
			annotation: annotationId ? readyState.projection.annotations.find((entry) => entry.annotationId === annotationId) : undefined,
			sessionId,
			reanchored,
			purgedCount,
		};
	}

	private toStoreState(loadResult: AnnotationLoadResult): StoreState {
		if (loadResult.status === 'invalid') {
			return {
				kind: 'invalid',
				storePath: loadResult.storePath,
				error: loadResult.error,
			};
		}

		return {
			kind: 'ready',
			store: loadResult.store,
			storePath: loadResult.storePath,
			version: loadResult.status === 'ready' ? loadResult.version : undefined,
			projection: deriveAnnotationWorkspaceProjection(this.workspaceFolder.uri.fsPath, loadResult.store),
		};
	}

	private toSnapshot(state: StoreState): AnnotationWorkspaceState {
		if (state.kind === 'invalid') {
			return {
				status: 'invalid',
				storePath: state.storePath,
				error: state.error,
			};
		}

		return {
			status: 'ready',
			projection: state.projection,
			storePath: state.storePath,
		};
	}

	private blocked(
		reason: AnnotationWorkspaceBlockedReason,
		message: string,
		error?: Error,
		latestState?: AnnotationWorkspaceState,
	): AnnotationWorkspaceBlockedResult {
		return {
			status: 'blocked',
			reason,
			message,
			storePath: this.storage.getStorePath(),
			error,
			latestState,
		};
	}

	private timestamp(): string {
		return this.clock().toISOString();
	}

	private fireStateChanged(state: AnnotationWorkspaceState): void {
		for (const listener of this.stateListeners) {
			listener(state);
		}
	}
	}

function createNodeAnnotationWorkspaceFileReader(): AnnotationWorkspaceFileReader {
	return {
		readFile: async (filePath) => {
			return fs.readFile(filePath, 'utf8');
		},
	};
}

function createNoopAnnotationWatcher(): AnnotationDisposable {
	return {
		dispose() {},
	};
}

function isBlockedResult(
	result: AnnotationWorkspaceBlockedResult | ReadyStoreState | AnnotationWorkspaceMutationPlan,
): result is AnnotationWorkspaceBlockedResult {
	return 'status' in result && result.status === 'blocked';
}

function findAnnotation(
	store: AnnotationStore,
	annotationId: string,
): { session: AnnotationSession; annotation: AnnotationEntry } | undefined {
	for (const session of store.sessions) {
		const annotation = session.annotations.find((entry) => entry.annotationId === annotationId);

		if (annotation) {
			return { session, annotation };
		}
	}

	return undefined;
}

function getActiveSession(store: AnnotationStore): AnnotationSession | undefined {
	return store.sessions.find((session) => session.sessionId === store.activeSessionId);
}

function normalizeRelativeFilePath(filePath: string): string {
	return filePath.replace(/\\/g, '/');
}

function normalizeAndValidateRelativeFilePath(filePath: string): string {
	return validateRelativeFilePath(normalizeRelativeFilePath(filePath), '$.filePath');
}

function createSessionSlug(name: string): string {
	const slug = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

	return slug || 'session';
}

function createOpaqueId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function areRangesEqual(left: AnnotationAnchor['range'], right: AnnotationAnchor['range']): boolean {
	return (
		left.start.line === right.start.line &&
		left.start.character === right.start.character &&
		left.end.line === right.end.line &&
		left.end.character === right.end.character
	);
}