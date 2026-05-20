import * as path from 'node:path';
import {
	annotationBackupRetentionLimit,
	createAnnotationBackupFileName,
	isAnnotationBackupFileName,
} from '../domain/annotationSchema';

export interface AnnotationFileStat {
	mtimeMs: number;
	size: number;
	ctimeMs?: number;
	}

export interface AnnotationFileSystem {
	copyFile(sourcePath: string, destinationPath: string): Promise<void>;
	mkdir(directoryPath: string): Promise<void>;
	readdir(directoryPath: string): Promise<string[]>;
	readFile?(filePath: string): Promise<Uint8Array>;
	stat(filePath: string): Promise<AnnotationFileStat>;
	unlink(filePath: string): Promise<void>;
	writeFile?(filePath: string, content: Uint8Array): Promise<void>;
}

export interface AnnotationBackupResult {
	backupPath?: string;
	deletedBackupPaths: string[];
}

export class AnnotationBackupService {
	public constructor(
		private readonly fileSystem: AnnotationFileSystem,
		private readonly retentionLimit = annotationBackupRetentionLimit,
	) {}

	public async createBackup(storePath: string, createdAt = new Date()): Promise<AnnotationBackupResult> {
		const storeDirectoryPath = path.dirname(storePath);
		await this.fileSystem.mkdir(storeDirectoryPath);
		const backupPath = path.join(storeDirectoryPath, createAnnotationBackupFileName(toBackupTimestamp(createdAt)));
		await this.fileSystem.copyFile(storePath, backupPath);
		const deletedBackupPaths = await this.pruneBackups(storeDirectoryPath);

		return {
			backupPath,
			deletedBackupPaths,
		};
	}

	public async pruneBackups(storeDirectoryPath: string): Promise<string[]> {
		const backupEntries = (await this.fileSystem.readdir(storeDirectoryPath))
			.filter((entry) => isAnnotationBackupFileName(entry))
			.sort((left, right) => right.localeCompare(left));
		const deletedBackupPaths: string[] = [];

		for (const entry of backupEntries.slice(this.retentionLimit)) {
			const backupPath = path.join(storeDirectoryPath, entry);
			await this.fileSystem.unlink(backupPath);
			deletedBackupPaths.push(backupPath);
		}

		return deletedBackupPaths;
	}
	}

function toBackupTimestamp(createdAt: Date): string {
	return createdAt.toISOString().replace(/[.:]/g, '-');
	}