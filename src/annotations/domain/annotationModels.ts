export const annotationSchemaVersion = 1;
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
	selectedLines: string[];
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

export function normalizeAnnotationSelectedLines(lines: readonly string[]): string[] {
	return lines.map((line) => truncateAnnotationContextLine(line));
}

export function createCanonicalAnnotationSelectionText(lines: readonly string[]): string {
	return normalizeAnnotationSelectedLines(lines).join('\n');
}

export function getAnnotationRangeEffectiveEndLine(range: AnnotationRange): number {
	return range.end.character === 0 && range.end.line > range.start.line
		? range.end.line - 1
		: range.end.line;
}

export function createAnnotationRangeSelectedLines(
	range: AnnotationRange,
	lines: readonly string[],
): string[] | undefined {
	const startLine = lines[range.start.line];
	const endLine = lines[range.end.line];

	if (startLine === undefined || endLine === undefined) {
		return undefined;
	}

	if (range.start.line === range.end.line) {
		const startCharacter = Math.min(range.start.character, startLine.length);
		const endCharacter = Math.min(range.end.character, startLine.length);

		return normalizeAnnotationSelectedLines([startLine.slice(startCharacter, endCharacter)]);
	}

	const startCharacter = Math.min(range.start.character, startLine.length);
	const endCharacter = Math.min(range.end.character, endLine.length);

	const effectiveEndLine = getAnnotationRangeEffectiveEndLine(range);
	const omitsTrailingEmptyLine = effectiveEndLine !== range.end.line;
	const selectedLines: string[] = [];

	for (let lineIndex = range.start.line; lineIndex <= effectiveEndLine; lineIndex += 1) {
		const line = lines[lineIndex];

		if (line === undefined) {
			return undefined;
		}

		if (lineIndex === range.start.line) {
			selectedLines.push(line.slice(startCharacter));
			continue;
		}

		if (lineIndex === effectiveEndLine) {
			selectedLines.push(omitsTrailingEmptyLine ? line : line.slice(0, endCharacter));
			continue;
		}

		selectedLines.push(line);
	}

	return normalizeAnnotationSelectedLines(selectedLines);
}

export function createAnnotationSearchText(range: AnnotationRange, lines: readonly string[]): string {
	const canonicalText = createCanonicalAnnotationSelectionText(lines);

	return getAnnotationRangeEffectiveEndLine(range) !== range.end.line
		? `${canonicalText}\n`
		: canonicalText;
}