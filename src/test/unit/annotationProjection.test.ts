import * as assert from 'assert';
import * as vscode from 'vscode';
import { AnnotationCodeLensProvider } from '../../annotations/presentation/annotationCodeLensProvider';
import { AnnotationCommentProjectionService } from '../../annotations/presentation/annotationCommentProjectionService';
import type { AnnotationWorkspaceProjection } from '../../annotations/application/projectionModel';

suite('Annotation Projection', () => {
	// Scenario: refreshing CodeLens for one workspace root preserves annotations projected for another root.
	test('keeps CodeLens entries isolated by workspace folder', () => {
		const provider = new AnnotationCodeLensProvider();

		provider.refresh(createProjection('e:/source/one', 'src/one.ts', 'annotation-one'));
		provider.refresh(createProjection('e:/source/two', 'src/two.ts', 'annotation-two'));

		const firstLenses = provider.provideCodeLenses(createDocument('e:/source/one/src/one.ts'));
		const secondLenses = provider.provideCodeLenses(createDocument('e:/source/two/src/two.ts'));

		assert.strictEqual(firstLenses.length, 1);
		assert.strictEqual(secondLenses.length, 1);
		assert.deepStrictEqual(firstLenses[0]?.command?.arguments, [{ annotationId: 'annotation-one' }]);
		assert.deepStrictEqual(secondLenses[0]?.command?.arguments, [{ annotationId: 'annotation-two' }]);

		provider.dispose();
	});

	// Scenario: refreshing comment projection for one workspace only disposes that workspace's previous threads.
	test('keeps comment threads isolated by workspace folder', () => {
		const controller = new FakeCommentController();
		const service = new AnnotationCommentProjectionService(controller.asController());

		service.refresh(createProjection('e:/source/one', 'src/one.ts', 'annotation-one'));
		service.refresh(createProjection('e:/source/two', 'src/two.ts', 'annotation-two'));
		service.refresh(createProjection('e:/source/one', 'src/one.ts', 'annotation-one-next'));

		assert.strictEqual(controller.threads.length, 3);
		assert.strictEqual(controller.threads[0]?.disposed, true);
		assert.strictEqual(controller.threads[1]?.disposed, false);
		assert.strictEqual(controller.threads[2]?.disposed, false);

		service.dispose();
		assert.strictEqual(controller.threads[1]?.disposed, true);
		assert.strictEqual(controller.threads[2]?.disposed, true);
	});
});

function createProjection(
	workspaceFolderPath: string,
	filePath: string,
	annotationId: string,
): AnnotationWorkspaceProjection {
	const annotation = {
		annotationId,
		sessionId: 'session-1',
		sessionName: 'Security pass',
		status: 'active' as const,
		anchorState: 'anchored' as const,
		body: `Body for ${annotationId}`,
		filePath,
		range: {
			start: { line: 1, character: 0 },
			end: { line: 1, character: 8 },
		},
		updatedAt: '2026-05-20T10:05:00.000Z',
		isActiveSession: true,
	};

	return {
		workspaceFolderPath,
		activeSessionId: 'session-1',
		sessions: [{
			sessionId: 'session-1',
			name: 'Security pass',
			sessionSlug: 'security-pass',
			isActive: true,
			annotationCount: 1,
			dismissedCount: 0,
			updatedAt: '2026-05-20T10:05:00.000Z',
		}],
		annotations: [annotation],
		activeAnnotations: [annotation],
		dismissedAnnotationsInActiveSession: 0,
	};
}

function createDocument(fsPath: string): vscode.TextDocument {
	return { uri: vscode.Uri.file(fsPath) } as vscode.TextDocument;
}

class FakeCommentController {
	public readonly threads: FakeCommentThread[] = [];
	private disposed = false;

	public asController(): vscode.CommentController {
		const controller = this;

		return {
			createCommentThread: (
				uri: vscode.Uri,
				range: vscode.Range,
				comments: readonly vscode.Comment[],
			) => {
				const thread = new FakeCommentThread(uri, range, comments);
				this.threads.push(thread);
				return thread.asThread();
			},
			dispose: () => {
				controller.disposed = true;
			},
		} as unknown as vscode.CommentController;
	}
}

class FakeCommentThread {
	public canReply = true;
	public comments: readonly vscode.Comment[];
	public contextValue: string | undefined;
	public disposed = false;
	public label: string | undefined;

	public constructor(
		public readonly uri: vscode.Uri,
		public readonly range: vscode.Range,
		comments: readonly vscode.Comment[],
	) {
		this.comments = comments;
	}

	public asThread(): vscode.CommentThread {
		const thread = this;

		return {
			uri: this.uri,
			range: this.range,
			get canReply() {
				return thread.canReply;
			},
			set canReply(value) {
				thread.canReply = value;
			},
			get comments() {
				return thread.comments;
			},
			set comments(value) {
				thread.comments = value;
			},
			get contextValue() {
				return thread.contextValue;
			},
			set contextValue(value) {
				thread.contextValue = value;
			},
			get label() {
				return thread.label;
			},
			set label(value) {
				thread.label = value;
			},
			dispose: () => {
				thread.disposed = true;
			},
		} as vscode.CommentThread;
	}
}