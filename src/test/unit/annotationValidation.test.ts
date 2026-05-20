import * as assert from 'assert';
import {
	annotationContextLineMaxLength,
	annotationSchemaVersion,
	annotationSelectedTextMaxLength,
	type AnnotationEntry,
	type AnnotationSession,
	type AnnotationStore,
} from '../../annotations/domain/annotationModels';
import {
	AnnotationStoreValidationError,
	parseAndValidateAnnotationStore,
	validateAnnotationStore,
} from '../../annotations/domain/annotationValidation';

suite('Annotation Validation', () => {
	// Scenario: a valid v1 annotation store is accepted at the runtime validation boundary.
	test('accepts a valid v1 annotation store', () => {
		const store = createStore();
		const parsed = parseAndValidateAnnotationStore(JSON.stringify(store));

		assert.deepStrictEqual(parsed, store);
	});

	// Scenario: a new annotation is rejected when selectedText exceeds the v1 maximum length.
	test('rejects selectedText beyond the v1 limit', () => {
		const store = createStore({
			sessions: [
				createSession({
					annotations: [
						createAnnotation({
							anchor: {
								...createAnnotation().anchor,
								selectedText: 'x'.repeat(annotationSelectedTextMaxLength + 1),
							},
						}),
					],
				}),
			],
		});

		assert.throws(() => validateAnnotationStore(store), AnnotationStoreValidationError);
	});

	// Scenario: persisted context fingerprint lines are rejected when they exceed the fixed v1 truncation bound.
	test('rejects context lines longer than the truncation limit', () => {
		const store = createStore({
			sessions: [
				createSession({
					annotations: [
						createAnnotation({
							anchor: {
								...createAnnotation().anchor,
								contextBeforeLines: ['x'.repeat(annotationContextLineMaxLength + 1)],
							},
						}),
					],
				}),
			],
		});

		assert.throws(() => validateAnnotationStore(store), AnnotationStoreValidationError);
	});

	// Scenario: runtime validation rejects stores whose active session marker points outside the session registry.
	test('rejects an unknown activeSessionId reference', () => {
		const store = createStore({ activeSessionId: 'missing-session' });

		assert.throws(() => validateAnnotationStore(store), AnnotationStoreValidationError);
	});

	// Scenario: runtime validation rejects filePaths that use parent-directory traversal to escape the workspace boundary.
	test('rejects filePaths with parent-directory traversal', () => {
		const store = createStore({
			sessions: [
				createSession({
					annotations: [
						createAnnotation({ filePath: '../outside.ts' }),
					],
				}),
			],
		});

		assert.throws(() => validateAnnotationStore(store), AnnotationStoreValidationError);
	});

	// Scenario: runtime validation rejects filePaths that contain relative-directory segments.
	test('rejects filePaths with current-directory segments', () => {
		const store = createStore({
			sessions: [
				createSession({
					annotations: [
						createAnnotation({ filePath: './src/file.ts' }),
					],
				}),
			],
		});

		assert.throws(() => validateAnnotationStore(store), AnnotationStoreValidationError);
	});
});

function createStore(overrides: Partial<AnnotationStore> = {}): AnnotationStore {
	return {
		schemaVersion: annotationSchemaVersion,
		activeSessionId: 'session-1',
		sessions: [createSession()],
		...overrides,
	};
	}

function createSession(overrides: Partial<AnnotationSession> = {}): AnnotationSession {
	return {
		sessionId: 'session-1',
		name: 'Security pass',
		sessionSlug: 'security-pass',
		createdAt: '2026-05-20T10:00:00.000Z',
		updatedAt: '2026-05-20T10:00:00.000Z',
		annotations: [createAnnotation()],
		...overrides,
	};
	}

function createAnnotation(overrides: Partial<AnnotationEntry> = {}): AnnotationEntry {
	return {
		annotationId: 'annotation-1',
		status: 'active',
		anchorState: 'anchored',
		body: 'Validate this boundary before invoking the tool.',
		filePath: 'src/extension.ts',
		createdAt: '2026-05-20T10:05:00.000Z',
		updatedAt: '2026-05-20T10:05:00.000Z',
		anchor: {
			range: {
				start: { line: 10, character: 4 },
				end: { line: 10, character: 44 },
			},
			selectedText: 'context.subscriptions.push(disposable);',
			contextBeforeLines: ['const disposable = registerThing();', ''],
			contextAfterLines: ['return disposable;', ''],
		},
		...overrides,
	};
	}