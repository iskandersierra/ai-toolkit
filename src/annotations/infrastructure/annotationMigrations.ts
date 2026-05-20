import { annotationSchemaVersion } from '../domain/annotationModels';
import { createAnnotationValidationError } from '../domain/annotationValidation';

export interface AnnotationMigrationResult {
	store: unknown;
	migratedFromVersion?: number;
}

export function detectAnnotationStoreVersion(candidate: unknown): number | undefined {
	if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
		return undefined;
	}

	const version = (candidate as Record<string, unknown>).schemaVersion;

	return typeof version === 'number' ? version : undefined;
	}

export function migrateAnnotationStore(candidate: unknown): AnnotationMigrationResult {
	const version = detectAnnotationStoreVersion(candidate);

	if (version === annotationSchemaVersion) {
		return { store: candidate };
	}

	if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
		throw createAnnotationValidationError('$', 'Expected an object annotation store for migration.');
	}

	if (version === undefined || version === 0) {
		const record = candidate as Record<string, unknown>;
		return {
			store: {
				...record,
				schemaVersion: annotationSchemaVersion,
				activeSessionId: record.activeSessionId ?? null,
			},
			migratedFromVersion: version ?? 0,
		};
	}

	throw createAnnotationValidationError(
		'$.schemaVersion',
		`Unsupported schemaVersion ${String(version)}. Expected ${annotationSchemaVersion}.`,
	);
	}