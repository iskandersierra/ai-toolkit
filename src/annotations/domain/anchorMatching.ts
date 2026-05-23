import {
	createAnnotationRangeSelectedLines,
	createAnnotationSearchText,
	createCanonicalAnnotationSelectedText,
	normalizeAnnotationContextLines,
	normalizeAnnotationSelectedLines,
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

interface LocalCandidate {
	range: AnnotationRange;
	selectedLines: string[];
	lineDistance: number;
	characterDistance: number;
	selectedLineSimilarity: number;
	contextScore: number;
}

export function createAnnotationAnchor(
	range: AnnotationRange,
	selectedLines: readonly string[] | string,
	contextBeforeLines: readonly string[],
	contextAfterLines: readonly string[],
): AnnotationAnchor {
	const normalizedSelectedLines = normalizeAnnotationSelectedLines(
		typeof selectedLines === 'string' ? selectedLines.split(/\r?\n/) : selectedLines,
	);

	return {
		range,
		selectedLines: normalizedSelectedLines,
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

	const proximityMatch = tryLocalRangeMatch(documentText, anchor);

	if (proximityMatch) {
		return proximityMatch;
	}

	return tryFingerprintRangeMatch(documentText, anchor);
	}

function tryExactRangeMatch(
	documentText: string,
	anchor: AnnotationAnchor,
): AnnotationReanchorMatch | undefined {
	const lineIndex = createLineIndex(documentText);
	const offsetRange = rangeToOffsets(documentText, anchor.range, lineIndex.lineStarts);

	if (!offsetRange) {
		return undefined;
	}

	if (
		documentText.slice(offsetRange.startOffset, offsetRange.endOffset) !==
		createAnnotationSearchText(anchor.range, anchor.selectedLines)
	) {
		return undefined;
	}

	const selectedLines = createAnnotationRangeSelectedLines(anchor.range, lineIndex.lines);

	if (
		selectedLines === undefined ||
		createCanonicalAnnotationSelectedText(selectedLines) !==
			createCanonicalAnnotationSelectedText(anchor.selectedLines)
	) {
		return undefined;
	}

	return {
		range: anchor.range,
		strategy: 'exact',
		contextScore: anchor.contextBeforeLines.length + anchor.contextAfterLines.length,
		contextScoreMax: anchor.contextBeforeLines.length + anchor.contextAfterLines.length,
	};
	}

const PROXIMITY_LINE_RADIUS = 50;
const PROXIMITY_CHARACTER_RADIUS = 20;
const MIN_LOCAL_SELECTED_TEXT_SIMILARITY = 0.5;

function tryLocalRangeMatch(
	documentText: string,
	anchor: AnnotationAnchor,
): AnnotationReanchorMatch | undefined {
	const lineIndex = createLineIndex(documentText);
	const contextScoreMax = anchor.contextBeforeLines.length + anchor.contextAfterLines.length;
	const candidates = createLocalCandidates(anchor, lineIndex.lines).filter(
		(candidate) =>
			candidate.selectedLineSimilarity >= MIN_LOCAL_SELECTED_TEXT_SIMILARITY || candidate.contextScore > 0,
	);

	if (candidates.length === 0) {
		return undefined;
	}

	candidates.sort((left, right) => {
		if (left.lineDistance !== right.lineDistance) {
			return left.lineDistance - right.lineDistance;
		}

		if (left.characterDistance !== right.characterDistance) {
			return left.characterDistance - right.characterDistance;
		}

		if (left.selectedLineSimilarity !== right.selectedLineSimilarity) {
			return right.selectedLineSimilarity - left.selectedLineSimilarity;
		}

		return right.contextScore - left.contextScore;
	});

	const [bestCandidate, secondCandidate] = candidates;

	if (!bestCandidate) {
		return undefined;
	}

	if (
		secondCandidate &&
		secondCandidate.lineDistance === bestCandidate.lineDistance &&
		secondCandidate.characterDistance === bestCandidate.characterDistance &&
		secondCandidate.selectedLineSimilarity === bestCandidate.selectedLineSimilarity &&
		secondCandidate.contextScore === bestCandidate.contextScore
	) {
		return undefined;
	}

	return {
		range: bestCandidate.range,
		strategy: 'fingerprint',
		contextScore: bestCandidate.contextScore,
		contextScoreMax,
	};
	}

function tryFingerprintRangeMatch(
	documentText: string,
	anchor: AnnotationAnchor,
): AnnotationReanchorMatch | undefined {
	const lineIndex = createLineIndex(documentText);
	const candidates = findSelectedTextCandidates(documentText, anchor, lineIndex).map((candidate) => ({
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

function createLocalCandidates(anchor: AnnotationAnchor, lines: readonly string[]): LocalCandidate[] {
	const candidates: LocalCandidate[] = [];
	const lineSpan = anchor.range.end.line - anchor.range.start.line;
	const startLine = Math.max(0, anchor.range.start.line - PROXIMITY_LINE_RADIUS);
	const endLine = Math.min(lines.length - 1, anchor.range.start.line + PROXIMITY_LINE_RADIUS);
	const seenRanges = new Set<string>();

	for (let candidateStartLine = startLine; candidateStartLine <= endLine; candidateStartLine += 1) {
		const candidateEndLine = candidateStartLine + lineSpan;

		if (candidateEndLine >= lines.length) {
			continue;
		}

		const startCharacters = collectCandidateStartCharacters(anchor, candidateStartLine, lines, candidateEndLine);

		for (const startCharacter of startCharacters) {
			const range = createShiftedRange(anchor.range, candidateStartLine, startCharacter);
			const key = serializeRange(range);

			if (seenRanges.has(key)) {
				continue;
			}

			const candidateText = getRangeText(lines, range);

			if (candidateText === undefined || candidateText.length === 0) {
				continue;
			}

			seenRanges.add(key);
			candidates.push({
				range,
				selectedLines: candidateText,
				lineDistance: Math.abs(candidateStartLine - anchor.range.start.line),
				characterDistance: Math.abs(startCharacter - anchor.range.start.character),
				selectedLineSimilarity: scoreSelectedTextSimilarity(anchor.selectedLines, candidateText),
				contextScore: scoreContextMatch(anchor, range, lines),
			});
		}
	}

	return candidates;
}

function collectCandidateStartCharacters(
	anchor: AnnotationAnchor,
	candidateStartLine: number,
	lines: readonly string[],
	candidateEndLine: number,
): number[] {
	const startCharacters = new Set<number>();
	const candidateLineLength = lines[candidateStartLine]?.length ?? 0;
	const candidateEndLineLength = lines[candidateEndLine]?.length ?? 0;
	const maxStartCharacter = getMaxStartCharacter(anchor.range, candidateLineLength, candidateEndLineLength);
	const minStartCharacter = Math.max(0, anchor.range.start.character - PROXIMITY_CHARACTER_RADIUS);
	const maxCharacterInRadius = Math.min(maxStartCharacter, anchor.range.start.character + PROXIMITY_CHARACTER_RADIUS);

	startCharacters.add(Math.min(anchor.range.start.character, maxStartCharacter));

	for (let character = minStartCharacter; character <= maxCharacterInRadius; character += 1) {
		startCharacters.add(character);
	}

	return [...startCharacters].sort((left, right) => left - right);
}

function getMaxStartCharacter(
	anchorRange: AnnotationRange,
	startLineLength: number,
	endLineLength: number,
): number {
	const lineSpan = anchorRange.end.line - anchorRange.start.line;

	if (lineSpan === 0) {
		return Math.max(0, startLineLength - (anchorRange.end.character - anchorRange.start.character));
	}

	if (anchorRange.start.character > startLineLength || anchorRange.end.character > endLineLength) {
		return -1;
	}

	return startLineLength;
}

function createShiftedRange(anchorRange: AnnotationRange, startLine: number, startCharacter: number): AnnotationRange {
	const lineSpan = anchorRange.end.line - anchorRange.start.line;
	const characterSpan = anchorRange.end.character - anchorRange.start.character;

	return {
		start: { line: startLine, character: startCharacter },
		end:
			lineSpan === 0
				? { line: startLine, character: startCharacter + characterSpan }
				: { line: startLine + lineSpan, character: anchorRange.end.character },
	};
}

function getRangeText(lines: readonly string[], range: AnnotationRange): string[] | undefined {
	return createAnnotationRangeSelectedLines(range, lines);
}


function scoreSelectedTextSimilarity(anchorSelectedLines: readonly string[], candidateSelectedLines: readonly string[]): number {
	const anchorSelectedText = createCanonicalAnnotationSelectedText(anchorSelectedLines);
	const candidateSelectedText = createCanonicalAnnotationSelectedText(candidateSelectedLines);

	if (anchorSelectedText === candidateSelectedText) {
		return 1;
	}

	const maxLength = Math.max(anchorSelectedText.length, candidateSelectedText.length);

	if (maxLength === 0) {
		return 1;
	}

	const distance = computeLevenshteinDistance(anchorSelectedText, candidateSelectedText);
	return 1 - distance / maxLength;
}

function computeLevenshteinDistance(left: string, right: string): number {
	if (left.length === 0) {
		return right.length;
	}

	if (right.length === 0) {
		return left.length;
	}

	const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
	const current = new Array<number>(right.length + 1);

	for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
		current[0] = leftIndex;

		for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
			const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
			current[rightIndex] = Math.min(
				current[rightIndex - 1] + 1,
				previous[rightIndex] + 1,
				previous[rightIndex - 1] + substitutionCost,
			);
		}

		for (let rightIndex = 0; rightIndex <= right.length; rightIndex += 1) {
			previous[rightIndex] = current[rightIndex];
		}
	}

	return previous[right.length];
}

function serializeRange(range: AnnotationRange): string {
	return `${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;
}

function findSelectedTextCandidates(
	documentText: string,
	anchor: AnnotationAnchor,
	lineIndex: ReturnType<typeof createLineIndex>,
): OffsetRange[] {
	const candidates: OffsetRange[] = [];
	const selectedText = createAnnotationSearchText(anchor.range, anchor.selectedLines);
	let searchStart = 0;

	while (searchStart <= documentText.length) {
		const foundAt = documentText.indexOf(selectedText, searchStart);

		if (foundAt < 0) {
			break;
		}

		const range = offsetsToRange(foundAt, foundAt + selectedText.length, lineIndex.lineStarts);
		const candidateSelectedLines = createAnnotationRangeSelectedLines(range, lineIndex.lines);

		if (
			candidateSelectedLines === undefined ||
			createCanonicalAnnotationSelectedText(candidateSelectedLines) !==
				createCanonicalAnnotationSelectedText(anchor.selectedLines)
		) {
			searchStart = foundAt + Math.max(selectedText.length, 1);
			continue;
		}

		candidates.push({
			startOffset: foundAt,
			endOffset: foundAt + selectedText.length,
			range,
		});
		searchStart = foundAt + Math.max(selectedText.length, 1);
	}

	return candidates;
}

function rangeToOffsets(
	documentText: string,
	range: AnnotationRange,
	lineStarts: readonly number[],
): OffsetRange | undefined {
	const startOffset = positionToOffset(range.start, lineStarts, documentText.length);
	const endOffset = positionToOffset(range.end, lineStarts, documentText.length);

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