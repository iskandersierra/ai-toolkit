export const annotationSchemaVersion = 1;
export const annotationSelectedTextMaxLength = 2000;
export const annotationContextLineMaxLength = 200;
export const annotationFingerprintContextLineCount = 2;

export type AnnotationStatus = 'active' | 'resolved' | 'dismissed';
export type AnnotationAnchorState = 'anchored' | 'orphaned';

export interface AnnotationPosition {
	line: number;
	character: number;
}

export interface AnnotationRange {
	start: AnnotationPosition;
	end: AnnotationPosition;
}

export interface AnnotationAnchor {
	range: AnnotationRange;
	selectedText: string;
	contextBeforeLines: string[];
	contextAfterLines: string[];
}

export interface AnnotationEntry {
	annotationId: string;
	status: AnnotationStatus;
	anchorState: AnnotationAnchorState;
	body: string;
	filePath: string;
	createdAt: string;
	updatedAt: string;
	anchor: AnnotationAnchor;
}

export interface AnnotationSession {
	sessionId: string;
	name: string;
	sessionSlug: string;
	createdAt: string;
	updatedAt: string;
	annotations: AnnotationEntry[];
}

export interface AnnotationStore {
	schemaVersion: typeof annotationSchemaVersion;
	activeSessionId: string | null;
	sessions: AnnotationSession[];
}

export interface AnnotationDocumentContext {
	text: string;
	lines: string[];
}

export interface PersistedAnnotationStoreVersion {
	mtimeMs: number;
	size: number;
	contentHash: string;
	fingerprint: string;
}

export function createEmptyAnnotationStore(): AnnotationStore {
	return {
		schemaVersion: annotationSchemaVersion,
		activeSessionId: null,
		sessions: [],
	};
}

export function truncateAnnotationContextLine(line: string): string {
	return line.slice(0, annotationContextLineMaxLength);
}

export function normalizeAnnotationContextLines(lines: readonly string[]): string[] {
	return lines
		.slice(-annotationFingerprintContextLineCount)
		.map((line) => truncateAnnotationContextLine(line));
}

export function normalizeSelectedText(text: string): string {
	return text
		.split(/\r?\n/)
		.map((line) => truncateAnnotationContextLine(line))
		.join('\n');
}