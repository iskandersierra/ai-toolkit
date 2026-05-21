import * as assert from 'assert';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {
	annotationSchemaVersion,
	type AnnotationSession,
	type AnnotationStore,
} from '../../annotations/domain/annotationModels';
import { annotationStoreRelativePath } from '../../annotations/domain/annotationSchema';
import { AnnotationStorageController } from '../../annotations/infrastructure/annotationStorageController';
import { AnnotationBackupService } from '../../annotations/infrastructure/annotationBackupService';
import type { AnnotationLogger } from '../../annotations/util/log';

suite('Annotation Storage Controller', () => {
	let workspaceFolderPath: string;

	setup(async () => {
		workspaceFolderPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-toolkit-annotations-'));
	});

	teardown(async () => {
		await fs.rm(workspaceFolderPath, { recursive: true, force: true });
	});

	// Scenario: concurrent saves for the same workspace folder are serialized so the store remains valid and ends with the last write.
	test('serializes concurrent saves per workspace folder', async () => {
		const controller = new AnnotationStorageController(workspaceFolderPath);
		const firstStore = createStore('annotation-1', 'First note');
		const secondStore = createStore('annotation-2', 'Second note');

		const results = await Promise.all([controller.save(firstStore), controller.save(secondStore)]);
		const loaded = await controller.load();

		assert.deepStrictEqual(
			results.map((result) => result.status),
			['saved', 'saved'],
		);
		assert.strictEqual(loaded.status, 'ready');

		if (loaded.status === 'ready') {
			assert.strictEqual(loaded.store.sessions[0]?.annotations[0]?.body, 'Second note');
		}
	});

	// Scenario: a stale expected file fingerprint is rejected after the store changes on disk.
	test('detects optimistic write conflicts from external changes', async () => {
		const controller = new AnnotationStorageController(workspaceFolderPath);
		const initialSave = await controller.save(createStore('annotation-1', 'Initial note'));
		assert.strictEqual(initialSave.status, 'saved');

		if (initialSave.status !== 'saved') {
			return;
		}

		await writeLegacyStore(workspaceFolderPath, createStore('annotation-1', 'External update'));

		const conflict = await controller.save(
			createStore('annotation-1', 'Retry with stale version'),
			initialSave.version,
		);

		assert.strictEqual(conflict.status, 'conflict');
	});

	// Scenario: loading a known pre-v1 store migrates it forward and creates a safety backup first.
	test('migrates a legacy store and creates a backup on load', async () => {
		await writeLegacyStore(workspaceFolderPath, {
			activeSessionId: 'session-1',
			sessions: [createSession('annotation-1', 'Legacy note')],
		});
		const controller = new AnnotationStorageController(workspaceFolderPath);

		const loaded = await controller.load();
		const backupFiles = await listBackupFiles(workspaceFolderPath);

		assert.strictEqual(loaded.status, 'ready');
		if (loaded.status === 'ready') {
			assert.strictEqual(loaded.store.schemaVersion, annotationSchemaVersion);
			assert.strictEqual(loaded.migratedFromVersion, 0);
		}
		assert.strictEqual(backupFiles.length, 1);
	});

	// Scenario: unreadable store files are surfaced as an invalid result instead of rejecting the load contract.
	test('returns invalid when reading the store fails with a non-ENOENT error', async () => {
		const fileSystem = createStorageFileSystem({
			readFile: async () => {
				throw createFileSystemError('EACCES', 'Permission denied');
			},
		});
		const controller = new AnnotationStorageController(
			workspaceFolderPath,
			fileSystem,
			new AnnotationBackupService(fileSystem, 3),
			createSilentLogger(),
		);

		const result = await controller.load();

		assert.strictEqual(result.status, 'invalid');
		if (result.status === 'invalid') {
			assert.match(result.error.message, /Permission denied/);
		}
	});

	// Scenario: optional backup failures do not prevent saving a validated store.
	test('saves successfully when optional backup creation fails', async () => {
		const existingStore = createStore('annotation-1', 'Initial note');
		const serializedStore = `${JSON.stringify(existingStore, null, 2)}\n`;
		let writeCount = 0;
		const fileSystem = createStorageFileSystem({
			copyFile: async () => {
				throw createFileSystemError('EACCES', 'Backup copy denied');
			},
			readFile: async () => Buffer.from(serializedStore, 'utf8'),
			stat: async () => ({
				mtimeMs: 1,
				size: Buffer.byteLength(serializedStore, 'utf8'),
				ctimeMs: 1,
			}),
			writeFile: async () => {
				writeCount += 1;
			},
		});
		const controller = new AnnotationStorageController(
			workspaceFolderPath,
			fileSystem,
			new AnnotationBackupService(fileSystem, 3),
			createSilentLogger(),
		);

		const result = await controller.save(createStore('annotation-2', 'Saved note'), undefined, {
			backupReason: 'purge',
			createdAt: new Date('2026-05-21T09:00:00.000Z'),
		});

		assert.strictEqual(result.status, 'saved');
		if (result.status === 'saved') {
			assert.strictEqual(result.backupPath, undefined);
		}
		assert.strictEqual(writeCount, 1);
	});

	// Scenario: destructive writes keep only the three most recent backups.
	test('caps retained backups at three files', async () => {
		const controller = new AnnotationStorageController(workspaceFolderPath);
		const initialSave = await controller.save(createStore('annotation-1', 'Initial note'));
		assert.strictEqual(initialSave.status, 'saved');

		for (let index = 0; index < 4; index += 1) {
			const saveResult = await controller.save(
				createStore(`annotation-${index + 2}`, `Backup note ${index}`),
				undefined,
				{
					backupReason: 'purge',
					createdAt: new Date(`2026-05-20T10:0${index}:00.000Z`),
				},
			);
			assert.strictEqual(saveResult.status, 'saved');
		}

		const backupFiles = await listBackupFiles(workspaceFolderPath);

		assert.strictEqual(backupFiles.length, 3);
	});
});

function createStore(annotationId: string, body: string): AnnotationStore {
	return {
		schemaVersion: annotationSchemaVersion,
		activeSessionId: 'session-1',
		sessions: [createSession(annotationId, body)],
	};
	}

function createSession(annotationId: string, body: string): AnnotationSession {
	return {
		sessionId: 'session-1',
		name: 'Security pass',
		sessionSlug: 'security-pass',
		createdAt: '2026-05-20T10:00:00.000Z',
		updatedAt: '2026-05-20T10:00:00.000Z',
		annotations: [
			{
				annotationId,
				status: 'active',
				anchorState: 'anchored',
				body,
				filePath: 'src/extension.ts',
				createdAt: '2026-05-20T10:05:00.000Z',
				updatedAt: '2026-05-20T10:05:00.000Z',
				anchor: {
					range: {
						start: { line: 10, character: 4 },
						end: { line: 10, character: 12 },
					},
					selectedText: 'target()',
					contextBeforeLines: ['before a', 'before b'],
					contextAfterLines: ['after a', 'after b'],
				},
			},
		],
	};
	}

async function writeLegacyStore(workspaceFolderPath: string, store: unknown): Promise<void> {
	const storePath = path.join(workspaceFolderPath, annotationStoreRelativePath);
	await fs.mkdir(path.dirname(storePath), { recursive: true });
	await fs.writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
	}

async function listBackupFiles(workspaceFolderPath: string): Promise<string[]> {
	const storeDirectoryPath = path.join(workspaceFolderPath, '.vscode');
	const entries = await fs.readdir(storeDirectoryPath);

	return entries.filter((entry) => entry.startsWith('ai-toolkit.annotations.backup-'));
	}

function createStorageFileSystem(overrides: Record<string, unknown> = {}) {
	return {
		copyFile: async () => undefined,
		mkdir: async () => undefined,
		readdir: async () => [],
		readFile: async () => Buffer.from('', 'utf8'),
		stat: async () => ({ mtimeMs: 0, size: 0, ctimeMs: 0 }),
		unlink: async () => undefined,
		writeFile: async () => undefined,
		...overrides,
	};
	}

function createFileSystemError(code: string, message: string): NodeJS.ErrnoException {
	const error = new Error(message) as NodeJS.ErrnoException;
	error.code = code;
	return error;
	}

function createSilentLogger(): AnnotationLogger {
	return {
		info: () => undefined,
		warn: () => undefined,
		error: () => undefined,
	};
	}