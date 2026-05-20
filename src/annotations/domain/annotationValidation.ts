import {
	annotationContextLineMaxLength,
	annotationFingerprintContextLineCount,
	annotationSchemaVersion,
	annotationSelectedTextMaxLength,
	createEmptyAnnotationStore,
	type AnnotationAnchor,
	type AnnotationAnchorState,
	type AnnotationEntry,
	type AnnotationPosition,
	type AnnotationRange,
	type AnnotationSession,
	type AnnotationStatus,
	type AnnotationStore,
} from './annotationModels';

export interface AnnotationValidationIssue {
	path: string;
	message: string;
}

export class AnnotationStoreValidationError extends Error {
	public readonly issues: readonly AnnotationValidationIssue[];

	public constructor(message: string, issues: readonly AnnotationValidationIssue[]) {
		super(message);
		this.name = 'AnnotationStoreValidationError';
		this.issues = issues;
	}
}

export function createAnnotationValidationError(
	path: string,
	message: string,
): AnnotationStoreValidationError {
	return new AnnotationStoreValidationError(message, [{ path, message }]);
}

export function parseAnnotationStoreJson(content: string): unknown {
	try {
		return JSON.parse(content) as unknown;
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Invalid JSON.';
		throw createAnnotationValidationError('$', `Unable to parse annotation store JSON: ${message}`);
	}
}

export function parseAndValidateAnnotationStore(content: string): AnnotationStore {
	return validateAnnotationStore(parseAnnotationStoreJson(content));
}

export function validateAnnotationStore(candidate: unknown): AnnotationStore {
	return validateStore(candidate, '$');
}

export function validateNewAnnotationSelectedText(selectedText: string): string {
	if (selectedText.length === 0) {
		throw createAnnotationValidationError('$.anchor.selectedText', 'selectedText must not be empty.');
	}

	if (selectedText.length > annotationSelectedTextMaxLength) {
		throw createAnnotationValidationError(
			'$.anchor.selectedText',
			`selectedText must be at most ${annotationSelectedTextMaxLength} characters.`,
		);
	}

	return selectedText;
	}

export function validateContextFingerprintLines(lines: readonly string[], path: string): string[] {
	if (lines.length > annotationFingerprintContextLineCount) {
		throw createAnnotationValidationError(
			path,
			`Context fingerprints may contain at most ${annotationFingerprintContextLineCount} lines.`,
		);
	}

	return lines.map((line, index) => {
		if (line.length > annotationContextLineMaxLength) {
			throw createAnnotationValidationError(
				`${path}[${index}]`,
				`Context lines must be at most ${annotationContextLineMaxLength} characters.`,
			);
		}

		return line;
	});
}

export function validateAnnotationAnchor(anchor: unknown, path: string): AnnotationAnchor {
	const value = asRecord(anchor, path);

	return {
		range: validateAnnotationRange(value.range, `${path}.range`),
		selectedText: validateNewAnnotationSelectedText(asString(value.selectedText, `${path}.selectedText`)),
		contextBeforeLines: validateContextFingerprintLines(
			asStringArray(value.contextBeforeLines, `${path}.contextBeforeLines`),
			`${path}.contextBeforeLines`,
		),
		contextAfterLines: validateContextFingerprintLines(
			asStringArray(value.contextAfterLines, `${path}.contextAfterLines`),
			`${path}.contextAfterLines`,
		),
	};
}

export function validateSchemaVersion(version: unknown, path: string): typeof annotationSchemaVersion {
	if (version !== annotationSchemaVersion) {
		throw createAnnotationValidationError(
			path,
			`Unsupported schemaVersion ${String(version)}. Expected ${annotationSchemaVersion}.`,
		);
	}

	return annotationSchemaVersion;
}

export function validateMaybeEmptyAnnotationStore(candidate: unknown): AnnotationStore {
	if (candidate === undefined || candidate === null) {
		return createEmptyAnnotationStore();
	}

	return validateAnnotationStore(candidate);
	}

function validateStore(candidate: unknown, path: string): AnnotationStore {
	const value = asRecord(candidate, path);
	const sessions = asArray(value.sessions, `${path}.sessions`).map((session, index) =>
		validateAnnotationSession(session, `${path}.sessions[${index}]`),
	);
	const activeSessionId = value.activeSessionId;

	if (activeSessionId !== null && activeSessionId !== undefined && typeof activeSessionId !== 'string') {
		throw createAnnotationValidationError(
			`${path}.activeSessionId`,
			'activeSessionId must be a string or null.',
		);
	}

	if (typeof activeSessionId === 'string' && !sessions.some((session) => session.sessionId === activeSessionId)) {
		throw createAnnotationValidationError(
			`${path}.activeSessionId`,
			'activeSessionId must reference a session in sessions[].',
		);
	}

	return {
		schemaVersion: validateSchemaVersion(value.schemaVersion, `${path}.schemaVersion`),
		activeSessionId: activeSessionId ?? null,
		sessions,
	};
	}

function validateAnnotationSession(candidate: unknown, path: string): AnnotationSession {
	const value = asRecord(candidate, path);

	return {
		sessionId: validateOpaqueId(asString(value.sessionId, `${path}.sessionId`), `${path}.sessionId`),
		name: validateNonEmptyString(asString(value.name, `${path}.name`), `${path}.name`),
		sessionSlug: validateNonEmptyString(asString(value.sessionSlug, `${path}.sessionSlug`), `${path}.sessionSlug`),
		createdAt: validateIsoDateString(asString(value.createdAt, `${path}.createdAt`), `${path}.createdAt`),
		updatedAt: validateIsoDateString(asString(value.updatedAt, `${path}.updatedAt`), `${path}.updatedAt`),
		annotations: asArray(value.annotations, `${path}.annotations`).map((annotation, index) =>
			validateAnnotationEntry(annotation, `${path}.annotations[${index}]`),
		),
	};
	}

function validateAnnotationEntry(candidate: unknown, path: string): AnnotationEntry {
	const value = asRecord(candidate, path);

	return {
		annotationId: validateOpaqueId(asString(value.annotationId, `${path}.annotationId`), `${path}.annotationId`),
		status: validateEnum<AnnotationStatus>(value.status, `${path}.status`, ['active', 'resolved', 'dismissed']),
		anchorState: validateEnum<AnnotationAnchorState>(
			value.anchorState,
			`${path}.anchorState`,
			['anchored', 'orphaned'],
		),
		body: validateNonEmptyString(asString(value.body, `${path}.body`), `${path}.body`),
		filePath: validateRelativeFilePath(asString(value.filePath, `${path}.filePath`), `${path}.filePath`),
		createdAt: validateIsoDateString(asString(value.createdAt, `${path}.createdAt`), `${path}.createdAt`),
		updatedAt: validateIsoDateString(asString(value.updatedAt, `${path}.updatedAt`), `${path}.updatedAt`),
		anchor: validateAnnotationAnchor(value.anchor, `${path}.anchor`),
	};
	}

function validateAnnotationRange(candidate: unknown, path: string): AnnotationRange {
	const value = asRecord(candidate, path);
	const start = validateAnnotationPosition(value.start, `${path}.start`);
	const end = validateAnnotationPosition(value.end, `${path}.end`);

	if (comparePositions(start, end) > 0) {
		throw createAnnotationValidationError(path, 'range.start must be before or equal to range.end.');
	}

	return { start, end };
	}

function validateAnnotationPosition(candidate: unknown, path: string): AnnotationPosition {
	const value = asRecord(candidate, path);
	const line = asNonNegativeInteger(value.line, `${path}.line`);
	const character = asNonNegativeInteger(value.character, `${path}.character`);

	return { line, character };
	}

function validateRelativeFilePath(value: string, path: string): string {
	if (value.length === 0 || value.startsWith('/') || value.includes('\\')) {
		throw createAnnotationValidationError(path, 'filePath must be a workspace-relative path using / separators.');
	}

	return value;
	}

function validateOpaqueId(value: string, path: string): string {
	return validateNonEmptyString(value, path);
	}

function validateIsoDateString(value: string, path: string): string {
	if (Number.isNaN(Date.parse(value))) {
		throw createAnnotationValidationError(path, 'Expected an ISO-8601 timestamp string.');
	}

	return value;
	}

function validateNonEmptyString(value: string, path: string): string {
	if (value.length === 0) {
		throw createAnnotationValidationError(path, 'Expected a non-empty string.');
	}

	return value;
	}

function validateEnum<TValue extends string>(
	value: unknown,
	path: string,
	allowedValues: readonly TValue[],
): TValue {
	if (typeof value !== 'string' || !allowedValues.includes(value as TValue)) {
		throw createAnnotationValidationError(path, `Expected one of: ${allowedValues.join(', ')}.`);
	}

	return value as TValue;
	}

function asRecord(candidate: unknown, path: string): Record<string, unknown> {
	if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
		throw createAnnotationValidationError(path, 'Expected an object.');
	}

	return candidate as Record<string, unknown>;
	}

function asArray(candidate: unknown, path: string): unknown[] {
	if (!Array.isArray(candidate)) {
		throw createAnnotationValidationError(path, 'Expected an array.');
	}

	return candidate;
	}

function asString(candidate: unknown, path: string): string {
	if (typeof candidate !== 'string') {
		throw createAnnotationValidationError(path, 'Expected a string.');
	}

	return candidate;
	}

function asStringArray(candidate: unknown, path: string): string[] {
	return asArray(candidate, path).map((entry, index) => asString(entry, `${path}[${index}]`));
	}

function asNonNegativeInteger(candidate: unknown, path: string): number {
	if (typeof candidate !== 'number' || !Number.isInteger(candidate) || candidate < 0) {
		throw createAnnotationValidationError(path, 'Expected a non-negative integer.');
	}

	return candidate;
	}

function comparePositions(left: AnnotationPosition, right: AnnotationPosition): number {
	if (left.line !== right.line) {
		return left.line - right.line;
	}

	return left.character - right.character;
	}