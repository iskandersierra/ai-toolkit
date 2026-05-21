import {
	normalizeAnnotationContextLines,
	type AnnotationAnchor,
	type AnnotationPosition,
	type AnnotationRange,
} from './annotationModels';

export interface AnnotationReanchorMatch {
	range: AnnotationRange;
	strategy: 'exact' | 'fingerprint';
	contextScore: number;
	contextScoreMax: number;
}

interface OffsetRange {
	startOffset: number;
	endOffset: number;
	range: AnnotationRange;
}

export function createAnnotationAnchor(
	range: AnnotationRange,
	selectedText: string,
	contextBeforeLines: readonly string[],
	contextAfterLines: readonly string[],
): AnnotationAnchor {
	return {
		range,
		selectedText,
		contextBeforeLines: normalizeAnnotationContextLines(contextBeforeLines),
		contextAfterLines: normalizeAnnotationContextLines(contextAfterLines),
	};
	}

export function findAnnotationReanchorMatch(
	documentText: string,
	anchor: AnnotationAnchor,
): AnnotationReanchorMatch | undefined {
	const exactMatch = tryExactRangeMatch(documentText, anchor);

	if (exactMatch) {
		return exactMatch;
	}

	return tryFingerprintRangeMatch(documentText, anchor);
	}

function tryExactRangeMatch(
	documentText: string,
	anchor: AnnotationAnchor,
): AnnotationReanchorMatch | undefined {
	const offsetRange = rangeToOffsets(documentText, anchor.range);

	if (!offsetRange) {
		return undefined;
	}

	if (documentText.slice(offsetRange.startOffset, offsetRange.endOffset) !== anchor.selectedText) {
		return undefined;
	}

	return {
		range: anchor.range,
		strategy: 'exact',
		contextScore: anchor.contextBeforeLines.length + anchor.contextAfterLines.length,
		contextScoreMax: anchor.contextBeforeLines.length + anchor.contextAfterLines.length,
	};
	}

function tryFingerprintRangeMatch(
	documentText: string,
	anchor: AnnotationAnchor,
): AnnotationReanchorMatch | undefined {
	const lineIndex = createLineIndex(documentText);
	const candidates = findSelectedTextCandidates(documentText, anchor.selectedText, lineIndex).map((candidate) => ({
		candidate,
		contextScore: scoreContextMatch(anchor, candidate.range, lineIndex.lines),
	}));
	const contextScoreMax = anchor.contextBeforeLines.length + anchor.contextAfterLines.length;

	if (contextScoreMax === 0 || candidates.length === 0) {
		return undefined;
	}

	candidates.sort((left, right) => right.contextScore - left.contextScore);
	const [bestCandidate, secondCandidate] = candidates;

	if (!bestCandidate || bestCandidate.contextScore !== contextScoreMax) {
		return undefined;
	}

	if (secondCandidate && secondCandidate.contextScore === bestCandidate.contextScore) {
		return undefined;
	}

	return {
		range: bestCandidate.candidate.range,
		strategy: 'fingerprint',
		contextScore: bestCandidate.contextScore,
		contextScoreMax,
	};
	}

function scoreContextMatch(anchor: AnnotationAnchor, range: AnnotationRange, lines: readonly string[]): number {
	let score = 0;
	const beforeStart = range.start.line - anchor.contextBeforeLines.length;

	for (let index = 0; index < anchor.contextBeforeLines.length; index += 1) {
		if (lines[beforeStart + index] === anchor.contextBeforeLines[index]) {
			score += 1;
		}
	}

	const afterStart = range.end.line + 1;

	for (let index = 0; index < anchor.contextAfterLines.length; index += 1) {
		if (lines[afterStart + index] === anchor.contextAfterLines[index]) {
			score += 1;
		}
	}

	return score;
	}

function findSelectedTextCandidates(
	documentText: string,
	selectedText: string,
	lineIndex: ReturnType<typeof createLineIndex>,
): OffsetRange[] {
	const candidates: OffsetRange[] = [];
	let searchStart = 0;

	while (searchStart <= documentText.length) {
		const foundAt = documentText.indexOf(selectedText, searchStart);

		if (foundAt < 0) {
			break;
		}

		const range = offsetsToRange(foundAt, foundAt + selectedText.length, lineIndex.lineStarts);
		candidates.push({
			startOffset: foundAt,
			endOffset: foundAt + selectedText.length,
			range,
		});
		searchStart = foundAt + Math.max(selectedText.length, 1);
	}

	return candidates;
	}

function rangeToOffsets(documentText: string, range: AnnotationRange): OffsetRange | undefined {
	const lineIndex = createLineIndex(documentText);
	const startOffset = positionToOffset(range.start, lineIndex.lineStarts, documentText.length);
	const endOffset = positionToOffset(range.end, lineIndex.lineStarts, documentText.length);

	if (startOffset === undefined || endOffset === undefined || startOffset > endOffset) {
		return undefined;
	}

	return {
		startOffset,
		endOffset,
		range,
	};
	}

function createLineIndex(documentText: string): { lines: string[]; lineStarts: number[] } {
	const lines = documentText.split(/\r?\n/);
	const lineStarts: number[] = [];
	let offset = 0;

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		lineStarts.push(offset);

		if (index === lines.length - 1) {
			offset += line.length;
			continue;
		}

		const separatorOffset = offset + line.length;
		const separatorLength =
			documentText[separatorOffset] === '\r' && documentText[separatorOffset + 1] === '\n' ? 2 : 1;
		offset += line.length + separatorLength;
	}

	return { lines, lineStarts };
	}

function positionToOffset(
	position: AnnotationPosition,
	lineStarts: readonly number[],
	documentLength: number,
): number | undefined {
	const lineStart = lineStarts[position.line];

	if (lineStart === undefined) {
		return undefined;
	}

	const offset = lineStart + position.character;

	if (offset > documentLength) {
		return undefined;
	}

	return offset;
	}

function offsetsToRange(
	startOffset: number,
	endOffset: number,
	lineStarts: readonly number[],
): AnnotationRange {
	return {
		start: offsetToPosition(startOffset, lineStarts),
		end: offsetToPosition(endOffset, lineStarts),
	};
	}

function offsetToPosition(offset: number, lineStarts: readonly number[]): AnnotationPosition {
	let line = 0;

	for (let index = 0; index < lineStarts.length; index += 1) {
		const lineStart = lineStarts[index];
		const nextLineStart = lineStarts[index + 1] ?? Number.POSITIVE_INFINITY;

		if (lineStart <= offset && offset < nextLineStart) {
			line = index;
			break;
		}
	}

	return {
		line,
		character: offset - lineStarts[line],
	};
	}