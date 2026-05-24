import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
	createEmptyAnnotationStore,
	type AnnotationStore,
	type PersistedAnnotationStoreVersion,
} from '../domain/annotationModels';
import {
	annotationBackupRetentionLimit,
	getAnnotationStoreDirectoryPath,
	getAnnotationStorePath,
} from '../domain/annotationSchema';
import {
	AnnotationStoreValidationError,
	createAnnotationValidationError,
	parseAnnotationStoreJson,
	validateAnnotationStore,
} from '../domain/annotationValidation';
import {
	logAnnotationStoreConflict,
	logAnnotationStoreReload,
	logInvalidAnnotationStore,
	createAnnotationLogger,
	type AnnotationLogger,
} from '../util/log';
import {
	AnnotationBackupService,
	type AnnotationFileStat,
	type AnnotationFileSystem,
} from './annotationBackupService';

type AnnotationStorageFileSystem = AnnotationFileSystem & {
	readFile(filePath: string): Promise<Uint8Array>;
	writeFile(filePath: string, content: Uint8Array): Promise<void>;
};

export interface AnnotationLoadReadyResult {
	status: 'ready';
	store: AnnotationStore;
	version: PersistedAnnotationStoreVersion;
	storePath: string;
}

export interface AnnotationLoadMissingResult {
	status: 'missing';
	store: AnnotationStore;
	storePath: string;
}

export interface AnnotationLoadInvalidResult {
	status: 'invalid';
	error: AnnotationStoreValidationError;
	storePath: string;
	version?: PersistedAnnotationStoreVersion;
}

export type AnnotationLoadResult =
	| AnnotationLoadReadyResult
	| AnnotationLoadMissingResult
	| AnnotationLoadInvalidResult;

export interface AnnotationSaveSuccessResult {
	status: 'saved';
	store: AnnotationStore;
	version: PersistedAnnotationStoreVersion;
	storePath: string;
	backupPath?: string;
}

export interface AnnotationSaveConflictResult {
	status: 'conflict';
	storePath: string;
	latest?: AnnotationLoadReadyResult | AnnotationLoadInvalidResult | AnnotationLoadMissingResult;
}

export interface AnnotationSaveInvalidResult {
	status: 'invalid';
	storePath: string;
	error: AnnotationStoreValidationError;
}

export type AnnotationSaveResult =
	| AnnotationSaveSuccessResult
	| AnnotationSaveConflictResult
	| AnnotationSaveInvalidResult;

export interface AnnotationStorageSaveOptions {
	backupReason?: 'purge';
	createdAt?: Date;
}

export class AnnotationStorageController {
	private readonly storePath: string;
	private readonly storeDirectoryPath: string;
	private writeQueue: Promise<unknown> = Promise.resolve();

	public constructor(
		workspaceFolderPath: string,
		private readonly fileSystem: AnnotationStorageFileSystem = createNodeAnnotationFileSystem(),
		private readonly backupService = new AnnotationBackupService(fileSystem, annotationBackupRetentionLimit),
		private readonly logger: AnnotationLogger = createAnnotationLogger(),
	) {
		this.storePath = getAnnotationStorePath(workspaceFolderPath);
		this.storeDirectoryPath = getAnnotationStoreDirectoryPath(workspaceFolderPath);
	}

	public getStorePath(): string {
		return this.storePath;
	}

	public async load(): Promise<AnnotationLoadResult> {
		return this.enqueue(async () => this.loadInternal());
	}

	public async save(
		store: AnnotationStore,
		expectedVersion?: PersistedAnnotationStoreVersion,
		options?: AnnotationStorageSaveOptions,
	): Promise<AnnotationSaveResult> {
		return this.enqueue(async () => this.saveInternal(store, expectedVersion, options));
	}

	private async loadInternal(): Promise<AnnotationLoadResult> {
		let snapshot: Awaited<ReturnType<AnnotationStorageController['readSnapshot']>>;

		try {
			snapshot = await this.readSnapshot();
		} catch (error) {
			const validationError = toAnnotationValidationError(error);
			logInvalidAnnotationStore(this.logger, this.storePath, validationError);
			return {
				status: 'invalid',
				error: validationError,
				storePath: this.storePath,
			};
		}

		if (!snapshot) {
			return {
				status: 'missing',
				store: createEmptyAnnotationStore(),
				storePath: this.storePath,
			};
		}

		try {
			const parsed = parseAnnotationStoreJson(snapshot.content);
			const store = validateAnnotationStore(parsed);

			logAnnotationStoreReload(this.logger, this.storePath, 'load');
			return {
				status: 'ready',
				store,
				version: snapshot.version,
				storePath: this.storePath,
			};
		} catch (error) {
			const validationError = toAnnotationValidationError(error);
			logInvalidAnnotationStore(this.logger, this.storePath, validationError);
			return {
				status: 'invalid',
				error: validationError,
				storePath: this.storePath,
				version: snapshot.version,
			};
		}
	}

	private async saveInternal(
		store: AnnotationStore,
		expectedVersion?: PersistedAnnotationStoreVersion,
		options?: AnnotationStorageSaveOptions,
	): Promise<AnnotationSaveResult> {
		let validatedStore: AnnotationStore;

		try {
			validatedStore = validateAnnotationStore(store);
		} catch (error) {
			return {
				status: 'invalid',
				storePath: this.storePath,
				error: toAnnotationValidationError(error),
			};
		}

		const currentState = await this.loadInternal();

		if (currentState.status === 'invalid') {
			return {
				status: 'invalid',
				storePath: this.storePath,
				error: currentState.error,
			};
		}

		if (
			expectedVersion &&
			currentState.status === 'ready' &&
			currentState.version.fingerprint !== expectedVersion.fingerprint
		) {
			logAnnotationStoreConflict(this.logger, this.storePath);
			return {
				status: 'conflict',
				storePath: this.storePath,
				latest: currentState,
			};
		}

		if (expectedVersion && currentState.status === 'missing') {
			logAnnotationStoreConflict(this.logger, this.storePath);
			return {
				status: 'conflict',
				storePath: this.storePath,
				latest: currentState,
			};
		}

		let backupPath: string | undefined;

		if (options?.backupReason && currentState.status === 'ready') {
			try {
				backupPath = (await this.backupService.createBackup(this.storePath, options.createdAt)).backupPath;
			} catch (error) {
				this.logger.warn('Optional annotation store backup failed before save.', {
					storePath: this.storePath,
					reason: options.backupReason,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		await this.fileSystem.mkdir(this.storeDirectoryPath);
		const serialized = serializeAnnotationStore(validatedStore);
		await this.writeStoreContent(serialized);
		const snapshot = await this.readSnapshot();

		if (!snapshot) {
			const error = createAnnotationValidationError(
				'$',
				'Expected annotation store snapshot after save.',
			);
			logInvalidAnnotationStore(this.logger, this.storePath, error);
			return {
				status: 'invalid',
				storePath: this.storePath,
				error,
			};
		}

		return {
			status: 'saved',
			store: validatedStore,
			version: snapshot.version,
			storePath: this.storePath,
			backupPath,
		};
	}

	private async readSnapshot(): Promise<{ content: string; version: PersistedAnnotationStoreVersion } | undefined> {
		try {
			const contentBuffer = await this.fileSystem.readFile(this.storePath);
			const content = Buffer.from(contentBuffer).toString('utf8');
			const stat = await this.fileSystem.stat(this.storePath);

			return {
				content,
				version: toPersistedStoreVersion(content, stat),
			};
		} catch (error) {
			if (isNotFoundError(error)) {
				return undefined;
			}

			throw error;
		}
	}

	private async writeStoreContent(content: string): Promise<void> {
		await this.fileSystem.writeFile(this.storePath, Buffer.from(content, 'utf8'));
	}

	private async enqueue<TValue>(task: () => Promise<TValue>): Promise<TValue> {
		const nextTask = this.writeQueue.then(task, task);
		this.writeQueue = nextTask.then(
			() => undefined,
			() => undefined,
		);
		return nextTask;
	}
	}

export function createNodeAnnotationFileSystem(): AnnotationStorageFileSystem {
	return {
		copyFile: async (sourcePath, destinationPath) => {
			await fs.copyFile(sourcePath, destinationPath);
		},
		mkdir: async (directoryPath) => {
			await fs.mkdir(directoryPath, { recursive: true });
		},
		readdir: async (directoryPath) => {
			return fs.readdir(directoryPath);
		},
		readFile: async (filePath) => {
			return fs.readFile(filePath);
		},
		stat: async (filePath) => {
			const result = await fs.stat(filePath);
			return {
				mtimeMs: result.mtimeMs,
				size: result.size,
				ctimeMs: result.ctimeMs,
			};
		},
		unlink: async (filePath) => {
			await fs.unlink(filePath);
		},
		writeFile: async (filePath, content) => {
			await fs.writeFile(filePath, content);
		},
	};
	}

function serializeAnnotationStore(store: AnnotationStore): string {
	return `${JSON.stringify(store, null, 2)}\n`;
	}

function toPersistedStoreVersion(content: string, stat: AnnotationFileStat): PersistedAnnotationStoreVersion {
	const contentHash = createHash('sha256').update(content, 'utf8').digest('hex');

	return {
		mtimeMs: stat.mtimeMs,
		size: stat.size,
		contentHash,
		fingerprint: `${stat.mtimeMs}:${stat.size}:${contentHash}`,
	};
	}

function toAnnotationValidationError(error: unknown): AnnotationStoreValidationError {
	if (error instanceof AnnotationStoreValidationError) {
		return error;
	}

	if (error instanceof Error) {
		return new AnnotationStoreValidationError(error.message, [{ path: '$', message: error.message }]);
	}

	return new AnnotationStoreValidationError('Unknown annotation store failure.', [
		{ path: '$', message: 'Unknown annotation store failure.' },
	]);
	}

function isNotFoundError(error: unknown): boolean {
	return error instanceof Error && 'code' in error && error.code === 'ENOENT';
	}