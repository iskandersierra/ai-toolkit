import * as assert from 'assert';
import {
	generateDraftContent,
	deriveDraftOutput,
} from '../../annotations/application/draftOutputService';
import { deriveAnnotationWorkspaceProjection } from '../../annotations/application/projectionModel';
import type { AnnotationStore } from '../../annotations/domain/annotationModels';
import type { DraftOutput } from '../../annotations/domain/draftShapes';

suite('Draft Output Service', () => {
	// Scenario: a Markdown draft is generated with correct header, summary, and per-file sections.
	test('generates Markdown with header, summary, and per-file sections', () => {
		const projection = createProjection(createStoreWithAnnotations());
		const { content, languageId } = generateDraftContent(projection, 'markdown');

		assert.strictEqual(languageId, 'markdown');
		assert.ok(content.includes('# Draft Output: Security pass'));
		assert.ok(content.includes('src/extension.ts'));
		assert.ok(content.includes('Validate this boundary'));
		assert.ok(content.includes('## Summary'));
	});

	// Scenario: a JSON draft parses to the DraftOutput shape.
	test('generates JSON that parses to DraftOutput shape', () => {
		const projection = createProjection(createStoreWithAnnotations());
		const { content, languageId } = generateDraftContent(projection, 'json');

		assert.strictEqual(languageId, 'json');
		const parsed = JSON.parse(content) as DraftOutput;
		assert.strictEqual(parsed.sessionName, 'Security pass');
		assert.strictEqual(parsed.files.length, 1);
		assert.strictEqual(parsed.files[0].filePath, 'src/extension.ts');
		assert.strictEqual(parsed.files[0].annotations.length, 1);
	});

	// Scenario: a YAML draft is generated with correct structure.
	test('generates YAML with correct structure', () => {
		const projection = createProjection(createStoreWithAnnotations());
		const { content, languageId } = generateDraftContent(projection, 'yaml');

		assert.strictEqual(languageId, 'yaml');
		assert.ok(content.includes('sessionName:'));
		assert.ok(content.includes('files:'));
		assert.ok(content.includes('filePath:'));
		assert.ok(content.includes('annotations:'));
	});

	// Scenario: a YAML draft escapes carriage returns inside quoted scalar values.
	test('escapes carriage returns in YAML scalar values', () => {
		const store = createStoreWithAnnotations();
		store.sessions[0].annotations[0].body = 'Line one\rLine two';

		const projection = createProjection(store);
		const { content } = generateDraftContent(projection, 'yaml');

		assert.ok(content.includes('body: "Line one\\rLine two"'));
	});

	// Scenario: dismissed annotations are excluded from the draft output.
	test('excludes dismissed annotations from draft output', () => {
		const store = createStoreWithAnnotations();
		store.sessions[0].annotations.push({
			annotationId: 'dismissed-1',
			status: 'dismissed',
			anchorState: 'anchored',
			body: 'This was dismissed',
			filePath: 'src/extension.ts',
			createdAt: '2026-05-20T10:06:00.000Z',
			updatedAt: '2026-05-20T10:06:00.000Z',
			anchor: {
				range: { start: { line: 20, character: 0 }, end: { line: 20, character: 30 } },
				selectedText: 'dismissed code',
				contextBeforeLines: [],
				contextAfterLines: [],
			},
		});

		const projection = createProjection(store);
		const draft = deriveDraftOutput(projection, 'json');
		const allAnnotations = draft.files.flatMap((f) => f.annotations);

		assert.ok(!allAnnotations.some((a) => a.annotationId === 'dismissed-1'));
	});

	// Scenario: resolved and orphaned annotations are included with their markers.
	test('includes resolved and orphaned annotations with markers', () => {
		const store = createStoreWithAnnotations();
		store.sessions[0].annotations.push(
			{
				annotationId: 'resolved-1',
				status: 'resolved',
				anchorState: 'anchored',
				body: 'This was resolved',
				filePath: 'src/extension.ts',
				createdAt: '2026-05-20T10:06:00.000Z',
				updatedAt: '2026-05-20T10:06:00.000Z',
				anchor: {
					range: { start: { line: 25, character: 0 }, end: { line: 25, character: 30 } },
					selectedText: 'resolved code',
					contextBeforeLines: [],
					contextAfterLines: [],
				},
			},
			{
				annotationId: 'orphaned-1',
				status: 'active',
				anchorState: 'orphaned',
				body: 'This is orphaned',
				filePath: 'src/other.ts',
				createdAt: '2026-05-20T10:07:00.000Z',
				updatedAt: '2026-05-20T10:07:00.000Z',
				anchor: {
					range: { start: { line: 5, character: 0 }, end: { line: 5, character: 20 } },
					selectedText: 'orphaned code',
					contextBeforeLines: [],
					contextAfterLines: [],
				},
			},
		);

		const projection = createProjection(store);
		const draft = deriveDraftOutput(projection, 'json');
		const allAnnotations = draft.files.flatMap((f) => f.annotations);

		assert.ok(allAnnotations.some((a) => a.status === 'resolved'));
		assert.ok(allAnnotations.some((a) => a.anchorState === 'orphaned'));
	});

	// Scenario: resolved and orphaned annotations are marked in Markdown output.
	test('marks resolved and orphaned annotations in Markdown', () => {
		const store = createStoreWithAnnotations();
		store.sessions[0].annotations.push({
			annotationId: 'orphaned-md',
			status: 'resolved',
			anchorState: 'orphaned',
			body: 'Resolved and orphaned',
			filePath: 'src/extension.ts',
			createdAt: '2026-05-20T10:06:00.000Z',
			updatedAt: '2026-05-20T10:06:00.000Z',
			anchor: {
				range: { start: { line: 30, character: 0 }, end: { line: 30, character: 20 } },
				selectedText: 'orphaned',
				contextBeforeLines: [],
				contextAfterLines: [],
			},
		});

		const projection = createProjection(store);
		const { content } = generateDraftContent(projection, 'markdown');

		assert.ok(content.includes('[resolved, orphaned]'));
	});

	// Scenario: draft output returns empty content gracefully when no annotations exist.
	test('generates empty draft when no active session annotations exist', () => {
		const store: AnnotationStore = {
			schemaVersion: 1,
			activeSessionId: 'session-1',
			sessions: [{
				sessionId: 'session-1',
				name: 'Empty session',
				sessionSlug: 'empty-session',
				createdAt: '2026-05-20T10:00:00.000Z',
				updatedAt: '2026-05-20T10:00:00.000Z',
				annotations: [],
			}],
		};

		const projection = createProjection(store);
		const draft = deriveDraftOutput(projection, 'json');

		assert.strictEqual(draft.files.length, 0);
		assert.strictEqual(draft.sessionName, 'Empty session');
	});
});

function createStoreWithAnnotations(): AnnotationStore {
	return {
		schemaVersion: 1,
		activeSessionId: 'session-1',
		sessions: [{
			sessionId: 'session-1',
			name: 'Security pass',
			sessionSlug: 'security-pass',
			createdAt: '2026-05-20T10:00:00.000Z',
			updatedAt: '2026-05-20T10:05:00.000Z',
			annotations: [{
				annotationId: 'annotation-1',
				status: 'active',
				anchorState: 'anchored',
				body: 'Validate this boundary before invoking the tool.',
				filePath: 'src/extension.ts',
				createdAt: '2026-05-20T10:05:00.000Z',
				updatedAt: '2026-05-20T10:05:00.000Z',
				anchor: {
					range: { start: { line: 10, character: 4 }, end: { line: 10, character: 44 } },
					selectedText: 'context.subscriptions.push(disposable);',
					contextBeforeLines: ['const disposable = registerThing();'],
					contextAfterLines: ['return disposable;'],
				},
			}],
		}],
	};
}

function createProjection(store: AnnotationStore) {
	return deriveAnnotationWorkspaceProjection('/workspace', store);
}
