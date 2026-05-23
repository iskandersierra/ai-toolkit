import {
	annotationSchemaVersion,
	type AnnotationStore,
} from '../domain/annotationModels';
import {
	createAnnotationValidationError,
	validateSchemaVersion,
} from '../domain/annotationValidation';

export interface AnnotationStoreMigrationResult {
	store: AnnotationStore;
	migratedFromVersion?: number;
}

export function detectAnnotationStoreVersion(candidate: unknown): number | undefined {
	if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
		return undefined;
	}

	const schemaVersion = (candidate as Record<string, unknown>).schemaVersion;
	return typeof schemaVersion === 'number' && Number.isInteger(schemaVersion) ? schemaVersion : undefined;
}

export function migrateAnnotationStore(candidate: unknown): AnnotationStoreMigrationResult {
	if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
		throw createAnnotationValidationError('$', 'Expected an object annotation store.');
	}

	const store = candidate as Record<string, unknown>;
	const detectedVersion = detectAnnotationStoreVersion(store);

	if (detectedVersion === undefined) {
		return {
			store: {
				...store,
				schemaVersion: annotationSchemaVersion,
				activeSessionId: store.activeSessionId ?? null,
			} as AnnotationStore,
			migratedFromVersion: 0,
		};
	}

	validateSchemaVersion(detectedVersion, '$.schemaVersion');
	return {
		store: candidate as unknown as AnnotationStore,
	};
}