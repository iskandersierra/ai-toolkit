import * as assert from 'assert';
import {
	createAnnotationAnchor,
	findAnnotationReanchorMatch,
} from '../../annotations/domain/anchorMatching';

suite('Anchor Matching', () => {
	// Scenario: reanchoring preserves the original range when the selected text still exists at the stored coordinates.
	test('prefers exact range matches', () => {
		const documentText = ['alpha', 'context line', 'target()', 'omega'].join('\n');
		const anchor = createAnnotationAnchor(
			{
				start: { line: 2, character: 0 },
				end: { line: 2, character: 8 },
			},
			'target()',
			['alpha', 'context line'],
			['omega'],
		);

		const match = findAnnotationReanchorMatch(documentText, anchor);

		assert.deepStrictEqual(match, {
			range: anchor.range,
			strategy: 'exact',
			contextScore: 3,
			contextScoreMax: 3,
		});
	});

	// Scenario: reanchoring preserves the stored range for CRLF documents when the selected text remains at the same coordinates.
	test('prefers exact range matches in CRLF documents', () => {
		const documentText = ['alpha', 'context line', 'target()', 'omega'].join('\r\n');
		const anchor = createAnnotationAnchor(
			{
				start: { line: 2, character: 0 },
				end: { line: 2, character: 8 },
			},
			'target()',
			['alpha', 'context line'],
			['omega'],
		);

		const match = findAnnotationReanchorMatch(documentText, anchor);

		assert.deepStrictEqual(match, {
			range: anchor.range,
			strategy: 'exact',
			contextScore: 3,
			contextScoreMax: 3,
		});
	});

	// Scenario: reanchoring falls back to the fingerprint when the selected text moves but its surrounding context remains unique.
	test('finds a unique fingerprint match after the range shifts', () => {
		const originalAnchor = createAnnotationAnchor(
			{
				start: { line: 1, character: 0 },
				end: { line: 1, character: 8 },
			},
			'target()',
			['before a', 'before b'],
			['after a', 'after b'],
		);
		const documentText = ['intro', 'before a', 'before b', 'target()', 'after a', 'after b', 'tail'].join('\n');

		const match = findAnnotationReanchorMatch(documentText, originalAnchor);

		assert.deepStrictEqual(match, {
			range: {
				start: { line: 3, character: 0 },
				end: { line: 3, character: 8 },
			},
			strategy: 'fingerprint',
			contextScore: 4,
			contextScoreMax: 4,
		});
	});

	// Scenario: reanchoring uses fingerprint matching in CRLF documents when the selected text moves to a new line.
	test('finds a unique fingerprint match after the range shifts in CRLF documents', () => {
		const originalAnchor = createAnnotationAnchor(
			{
				start: { line: 1, character: 0 },
				end: { line: 1, character: 8 },
			},
			'target()',
			['before a', 'before b'],
			['after a', 'after b'],
		);
		const documentText = ['intro', 'before a', 'before b', 'target()', 'after a', 'after b', 'tail'].join('\r\n');

		const match = findAnnotationReanchorMatch(documentText, originalAnchor);

		assert.deepStrictEqual(match, {
			range: {
				start: { line: 3, character: 0 },
				end: { line: 3, character: 8 },
			},
			strategy: 'fingerprint',
			contextScore: 4,
			contextScoreMax: 4,
		});
	});

	// Scenario: Given two identical texts at distances 1 and 4 from the stored line, When reanchoring, Then proximity picks the closer occurrence.
	test('proximity picks the closer of two identical candidates when distances differ', () => {
		const anchor = createAnnotationAnchor(
			{
				start: { line: 0, character: 0 },
				end: { line: 0, character: 8 },
			},
			'target()',
			['before'],
			['after'],
		);
		const documentText = ['before', 'target()', 'after', 'before', 'target()', 'after'].join('\n');

		const match = findAnnotationReanchorMatch(documentText, anchor);

		assert.deepStrictEqual(match, {
			range: {
				start: { line: 1, character: 0 },
				end: { line: 1, character: 8 },
			},
			strategy: 'fingerprint',
			contextScore: 2,
			contextScoreMax: 2,
		});
	});

	// Scenario: Given selectedText is a single line of 300 chars, When createAnnotationAnchor is called, Then selectedText is truncated to 200 chars.
	test('createAnnotationAnchor truncates a single-line selectedText to 200 characters', () => {
		const longText = 'a'.repeat(300);
		const anchor = createAnnotationAnchor(
			{ start: { line: 0, character: 0 }, end: { line: 0, character: 300 } },
			longText,
			[],
			[],
		);

		assert.strictEqual(anchor.selectedText, 'a'.repeat(200));
	});

	// Scenario: Given selectedText spans two CRLF lines each of 300 chars, When createAnnotationAnchor is called, Then each line is truncated to 200 chars and joined with LF.
	test('createAnnotationAnchor truncates each line of a multiline selectedText to 200 characters', () => {
		const longLine = 'b'.repeat(300);
		const multilineText = `${longLine}\r\n${longLine}`;
		const anchor = createAnnotationAnchor(
			{ start: { line: 0, character: 0 }, end: { line: 1, character: 300 } },
			multilineText,
			[],
			[],
		);

		const expectedLine = 'b'.repeat(200);
		assert.strictEqual(anchor.selectedText, `${expectedLine}\n${expectedLine}`);
	});

	// Scenario: Given selectedText moved to line 5 (within 50 lines) with changed surrounding context, When reanchoring, Then proximity returns the match without requiring full context agreement.
	test('findAnnotationReanchorMatch returns proximity match when text has moved within 50 lines', () => {
		const anchor = createAnnotationAnchor(
			{ start: { line: 0, character: 0 }, end: { line: 0, character: 8 } },
			'target()',
			['old_before'],
			['old_after'],
		);
		const documentText = ['x', 'x', 'x', 'x', 'new_before', 'target()', 'new_after'].join('\n');

		const match = findAnnotationReanchorMatch(documentText, anchor);

		assert.deepStrictEqual(match, {
			range: {
				start: { line: 5, character: 0 },
				end: { line: 5, character: 8 },
			},
			strategy: 'fingerprint',
			contextScore: 0,
			contextScoreMax: 2,
		});
	});

	// Scenario: Given selectedText moved to line 55 (beyond the 50-line proximity radius) with matching context, When reanchoring, Then proximity yields no match and fingerprint succeeds.
	test('findAnnotationReanchorMatch falls through proximity to fingerprint when no candidates within radius', () => {
		const anchor = createAnnotationAnchor(
			{ start: { line: 0, character: 0 }, end: { line: 0, character: 8 } },
			'target()',
			['before'],
			['after'],
		);
		const docLines = [...Array.from({ length: 54 }, (_, i) => `line_${i}`), 'before', 'target()', 'after'];
		const documentText = docLines.join('\n');

		const match = findAnnotationReanchorMatch(documentText, anchor);

		assert.deepStrictEqual(match, {
			range: {
				start: { line: 55, character: 0 },
				end: { line: 55, character: 8 },
			},
			strategy: 'fingerprint',
			contextScore: 2,
			contextScoreMax: 2,
		});
	});

	// Scenario: Given two identical texts equidistant from the stored line with equal context scores, When reanchoring, Then proximity rejects the tie and the annotation is orphaned.
	test('findAnnotationReanchorMatch rejects proximity tie when two candidates are equidistant with equal context score', () => {
		const anchor = createAnnotationAnchor(
			{ start: { line: 5, character: 0 }, end: { line: 5, character: 8 } },
			'target()',
			['old_before'],
			['old_after'],
		);
		const docLines = [
			'filler',
			'filler',
			'new_ctx',
			'target()',
			'new_ctx',
			'filler',
			'new_ctx',
			'target()',
			'new_ctx',
		];
		const documentText = docLines.join('\n');

		const match = findAnnotationReanchorMatch(documentText, anchor);

		assert.strictEqual(match, undefined);
	});
});