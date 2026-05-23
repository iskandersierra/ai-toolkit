import * as assert from 'assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
	annotationContextLineMaxLength,
	annotationFingerprintContextLineCount,
	annotationSchemaVersion,
	type AnnotationEntry,
	type AnnotationSession,
	type AnnotationStore,
} from '../../annotations/domain/annotationModels';
import { annotationSchemaMetadata } from '../../annotations/domain/annotationSchema';
import {
	AnnotationStoreValidationError,
	parseAnnotationStoreJson,
	parseAndValidateAnnotationStore,
	validateContextFingerprintLines,
	validateMaybeEmptyAnnotationStore,
	validateNewAnnotationSelectedLines,
	validateAnnotationStore,
} from '../../annotations/domain/annotationValidation';

suite('Annotation Validation', () => {
	// Scenario: a valid v1 annotation store is accepted at the runtime validation boundary.
	test('accepts a valid v1 annotation store', () => {
		const store = createStore();
		const parsed = parseAndValidateAnnotationStore(JSON.stringify(store));

		assert.deepStrictEqual(parsed, store);
	});

	// Scenario: a persisted store is rejected when a selectedLines fragment exceeds the per-line 200-char contract.
	test('rejects selectedLines fragments longer than the per-line truncation limit', () => {
		const store = createStore({
			sessions: [
				createSession({
					annotations: [
						createAnnotation({
							anchor: {
								...createAnnotation().anchor,
								selectedLines: ['x'.repeat(annotationContextLineMaxLength + 1)],
							},
						}),
					],
				}),
			],
		});

		assert.throws(
			() => validateAnnotationStore(store),
			(error: unknown) => {
				assert.ok(error instanceof AnnotationStoreValidationError);
				assert.strictEqual(error.issues[0]?.path, '$.anchor.selectedLines[0]');
				return true;
			},
		);
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

	// Scenario: schema metadata documents per-line selectedLines truncation instead of the stale legacy total-length contract.
	test('publishes schema metadata that matches the runtime selectedLines contract', () => {
		assert.deepStrictEqual(annotationSchemaMetadata, {
			version: annotationSchemaVersion,
			selectedLinesDescription: `Stored selectedLines preserves the captured line count, including interior blank lines, and truncates each line to ${annotationContextLineMaxLength} characters.`,
			selectedLineMaxLength: annotationContextLineMaxLength,
			contextLineMaxLength: annotationContextLineMaxLength,
			contextLineCount: 2,
		});
	});

	// Scenario: the persisted JSON schema rejects blank-only selectedLines arrays the same way runtime validation does.
	test('schema requires selectedLines arrays to contain at least one non-empty fragment', () => {
		const schema = JSON.parse(
			fs.readFileSync(path.join(process.cwd(), 'schemas', 'ai-toolkit.annotations.schema.json'), 'utf8'),
		) as {
			$defs?: {
				anchor?: {
					properties?: {
						selectedLines?: {
							contains?: unknown;
						};
					};
				};
			};
		};

		assert.deepStrictEqual(schema.$defs?.anchor?.properties?.selectedLines?.contains, {
			type: 'string',
			minLength: 1,
		});
	});

	// Scenario: runtime validation rejects stores whose active session marker points outside the session registry.
	test('rejects an unknown activeSessionId reference', () => {
		const store = createStore({ activeSessionId: 'missing-session' });

		assert.throws(() => validateAnnotationStore(store), AnnotationStoreValidationError);
	});

	// Scenario: malformed persisted JSON is rejected with a validation error at the parse boundary.
	test('rejects malformed annotation store json', () => {
		assert.throws(
			() => parseAnnotationStoreJson('{"schemaVersion":1'),
			(error: unknown) => {
				assert.ok(error instanceof AnnotationStoreValidationError);
				assert.strictEqual(error.issues[0]?.path, '$');
				assert.match(error.issues[0]?.message ?? '', /Unable to parse annotation store JSON:/);
				return true;
			},
		);
	});

	// Scenario: selectedLines validation rejects empty captures before an annotation can be persisted.
	test('rejects empty selectedLines arrays', () => {
		assert.throws(
			() => validateNewAnnotationSelectedLines([]),
			(error: unknown) => {
				assert.ok(error instanceof AnnotationStoreValidationError);
				assert.strictEqual(error.issues[0]?.path, '$.anchor.selectedLines');
				return true;
			},
		);
	});

	// Scenario: selectedLines validation rejects arrays whose fragments are all empty before an annotation can be persisted.
	test('rejects selectedLines arrays with only empty fragments', () => {
		assert.throws(
			() => validateNewAnnotationSelectedLines(['', '']),
			(error: unknown) => {
				assert.ok(error instanceof AnnotationStoreValidationError);
				assert.strictEqual(error.issues[0]?.path, '$.anchor.selectedLines');
				return true;
			},
		);
	});

	// Scenario: context fingerprints are rejected when they exceed the configured line-count limit.
	test('rejects context fingerprints with too many lines', () => {
		assert.throws(
			() => validateContextFingerprintLines(new Array(annotationFingerprintContextLineCount + 1).fill('context'), '$.anchor.contextBeforeLines'),
			(error: unknown) => {
				assert.ok(error instanceof AnnotationStoreValidationError);
				assert.strictEqual(error.issues[0]?.path, '$.anchor.contextBeforeLines');
				return true;
			},
		);
	});

	// Scenario: empty or missing store content is normalized into a fresh empty store for first-run workflows.
	test('normalizes undefined and null stores to an empty store', () => {
		assert.deepStrictEqual(validateMaybeEmptyAnnotationStore(undefined), {
			schemaVersion: annotationSchemaVersion,
			activeSessionId: null,
			sessions: [],
		});
		assert.deepStrictEqual(validateMaybeEmptyAnnotationStore(null), {
			schemaVersion: annotationSchemaVersion,
			activeSessionId: null,
			sessions: [],
		});
	});

	// Scenario: stores without an explicit activeSessionId are normalized to null instead of failing validation.
	test('normalizes a missing activeSessionId to null', () => {
		const store = createStore();
		const { activeSessionId: _activeSessionId, ...withoutActiveSession } = store as AnnotationStore & {
			activeSessionId?: string | null;
		};

		const parsed = validateAnnotationStore(withoutActiveSession);

		assert.strictEqual(parsed.activeSessionId, null);
	});

	// Scenario: range validation rejects annotations whose start position appears after the end position.
	test('rejects annotation ranges whose start is after the end', () => {
		const store = createStore({
			sessions: [
				createSession({
					annotations: [
						createAnnotation({
							anchor: {
								...createAnnotation().anchor,
								range: {
									start: { line: 11, character: 0 },
									end: { line: 10, character: 0 },
								},
							},
						}),
					],
				}),
			],
		});

		assert.throws(() => validateAnnotationStore(store), AnnotationStoreValidationError);
	});

	// Scenario: runtime validation rejects absolute persisted file paths to preserve workspace-relative addressing.
	test('rejects absolute file paths', () => {
		const store = createStore({
			sessions: [
				createSession({
					annotations: [
						createAnnotation({ filePath: '/src/extension.ts' }),
					],
				}),
			],
		});

		assert.throws(() => validateAnnotationStore(store), AnnotationStoreValidationError);
	});

	// Scenario: runtime validation rejects invalid ISO timestamps on persisted annotations.
	test('rejects invalid timestamp values', () => {
		const store = createStore({
			sessions: [
				createSession({
					annotations: [
						createAnnotation({ updatedAt: 'not-a-timestamp' }),
					],
				}),
			],
		});

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
			selectedLines: ['context.subscriptions.push(disposable);'],
			contextBeforeLines: ['const disposable = registerThing();', ''],
			contextAfterLines: ['return disposable;', ''],
		},
		...overrides,
	};
	}