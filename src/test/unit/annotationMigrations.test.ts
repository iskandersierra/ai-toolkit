import * as assert from 'assert';
import { annotationSchemaVersion } from '../../annotations/domain/annotationModels';
import { AnnotationStoreValidationError } from '../../annotations/domain/annotationValidation';
import {
	detectAnnotationStoreVersion,
	migrateAnnotationStore,
} from '../../annotations/infrastructure/annotationMigrations';

suite('Annotation Migrations', () => {
	// Scenario: version detection ignores non-object values and non-numeric schema versions.
	test('detects versions only from object stores with numeric schemaVersion values', () => {
		assert.strictEqual(detectAnnotationStoreVersion(undefined), undefined);
		assert.strictEqual(detectAnnotationStoreVersion([]), undefined);
		assert.strictEqual(detectAnnotationStoreVersion({ schemaVersion: '1' }), undefined);
		assert.strictEqual(detectAnnotationStoreVersion({ schemaVersion: annotationSchemaVersion }), annotationSchemaVersion);
	});

	// Scenario: a current-version store is returned unchanged without a migration marker.
	test('returns current-version stores unchanged', () => {
		const store = {
			schemaVersion: annotationSchemaVersion,
			activeSessionId: 'session-1',
			sessions: [],
		};

		const result = migrateAnnotationStore(store);

		assert.deepStrictEqual(result, { store });
	});

	// Scenario: legacy stores are upgraded to the current schema and default the active session id to null.
	test('migrates legacy stores and normalizes missing active session ids', () => {
		const legacyStore = {
			sessions: [],
		};

		const result = migrateAnnotationStore(legacyStore);

		assert.deepStrictEqual(result, {
			store: {
				...legacyStore,
				schemaVersion: annotationSchemaVersion,
				activeSessionId: null,
			},
			migratedFromVersion: 0,
		});
	});

	// Scenario: unsupported schema versions are rejected with a validation error on schemaVersion.
	test('rejects unsupported schema versions', () => {
		assert.throws(
			() => migrateAnnotationStore({ schemaVersion: annotationSchemaVersion + 1, sessions: [] }),
			(error: unknown) => {
				assert.ok(error instanceof AnnotationStoreValidationError);
				assert.strictEqual(error.issues[0]?.path, '$.schemaVersion');
				assert.match(error.message, /Unsupported schemaVersion/);
				return true;
			},
		);
	});

	// Scenario: non-object migration inputs are rejected before any schema upgrade is attempted.
	test('rejects non-object migration candidates', () => {
		assert.throws(
			() => migrateAnnotationStore(null),
			(error: unknown) => {
				assert.ok(error instanceof AnnotationStoreValidationError);
				assert.strictEqual(error.issues[0]?.path, '$');
				assert.match(error.message, /Expected an object annotation store/);
				return true;
			},
		);
	});
});