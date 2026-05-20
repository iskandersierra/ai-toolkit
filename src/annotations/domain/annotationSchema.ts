import * as path from 'node:path';
import {
	annotationContextLineMaxLength,
	annotationFingerprintContextLineCount,
	annotationSchemaVersion,
	annotationSelectedTextMaxLength,
} from './annotationModels';

export const annotationStoreRelativePath = '.vscode/ai-toolkit.annotations.json';
export const annotationSchemaRelativePath = 'schemas/ai-toolkit.annotations.schema.json';
export const annotationBackupFilePrefix = 'ai-toolkit.annotations.backup-';
export const annotationBackupFileSuffix = '.json';
export const annotationBackupRetentionLimit = 3;

export const annotationSchemaMetadata = {
	version: annotationSchemaVersion,
	selectedTextMaxLength: annotationSelectedTextMaxLength,
	contextLineMaxLength: annotationContextLineMaxLength,
	contextLineCount: annotationFingerprintContextLineCount,
} as const;

export function getAnnotationStorePath(workspaceFolderPath: string): string {
	return path.join(workspaceFolderPath, annotationStoreRelativePath);
}

export function getAnnotationStoreDirectoryPath(workspaceFolderPath: string): string {
	return path.dirname(getAnnotationStorePath(workspaceFolderPath));
}

export function getAnnotationSchemaAssetPath(extensionPath: string): string {
	return path.join(extensionPath, annotationSchemaRelativePath);
}

export function createAnnotationBackupFileName(timestamp: string): string {
	return `${annotationBackupFilePrefix}${timestamp}${annotationBackupFileSuffix}`;
}

export function isAnnotationBackupFileName(fileName: string): boolean {
	return fileName.startsWith(annotationBackupFilePrefix) && fileName.endsWith(annotationBackupFileSuffix);
}