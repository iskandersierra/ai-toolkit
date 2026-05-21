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

	// Scenario: reanchoring leaves the annotation orphaned when fingerprint matching is ambiguous.
	test('returns no match when the fingerprint is ambiguous', () => {
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

		assert.strictEqual(match, undefined);
	});
});