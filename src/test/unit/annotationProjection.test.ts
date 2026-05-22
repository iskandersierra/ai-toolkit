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

	// Scenario: Given an orphaned annotation, When CodeLens entries are produced, Then the edit action is accompanied by an orphaned warning lens.
	test('adds an orphaned warning CodeLens for orphaned annotations', () => {
		const provider = new AnnotationCodeLensProvider();
		const projection = createProjection('e:/source/one', 'src/one.ts', 'annotation-one');

		projection.activeAnnotations[0] = {
			...projection.activeAnnotations[0],
			anchorState: 'orphaned',
		};
		projection.annotations[0] = projection.activeAnnotations[0];

		provider.refresh(projection);

		const lenses = provider.provideCodeLenses(createDocument('e:/source/one/src/one.ts'));

		assert.strictEqual(lenses.length, 2);
		assert.strictEqual(lenses[0]?.command?.title, 'Edit Annotation');
		assert.strictEqual(lenses[1]?.command?.title, '⚠ Orphaned');
		assert.strictEqual(lenses[1]?.command?.command, '');

		provider.dispose();
	});

	// Scenario: Given a document outside tracked workspace roots, When CodeLens entries are requested, Then no entries are returned.
	test('returns no CodeLens entries for documents outside tracked workspaces', () => {
		const provider = new AnnotationCodeLensProvider();

		provider.refresh(createProjection('e:/source/one', 'src/one.ts', 'annotation-one'));

		const lenses = provider.provideCodeLenses(createDocument('e:/other/place/outside.ts'));

		assert.deepStrictEqual(lenses, []);

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

	// Scenario: Given a resolved annotation, When refresh is called, Then the created thread has state CommentThreadState.Resolved.
	test('refresh sets thread state to Resolved for a resolved annotation', () => {
		const controller = new FakeCommentController();
		const service = new AnnotationCommentProjectionService(controller.asController());

		service.refresh(createProjection('e:/source/one', 'src/one.ts', 'annotation-one', 'resolved'));

		assert.strictEqual(controller.threads[0]?.state, vscode.CommentThreadState.Resolved);

		service.dispose();
	});

	// Scenario: Given an active annotation, When refresh is called, Then the created thread has state CommentThreadState.Unresolved.
	test('refresh sets thread state to Unresolved for an active annotation', () => {
		const controller = new FakeCommentController();
		const service = new AnnotationCommentProjectionService(controller.asController());

		service.refresh(createProjection('e:/source/one', 'src/one.ts', 'annotation-one', 'active'));

		assert.strictEqual(controller.threads[0]?.state, vscode.CommentThreadState.Unresolved);

		service.dispose();
	});

	// Scenario: Given a thread created by refresh, When getAnnotationId is called, Then it returns the annotationId; after thread disposal via re-refresh it returns undefined.
	test('getAnnotationId returns the annotationId for a live thread and undefined after disposal', () => {
		const controller = new FakeCommentController();
		const service = new AnnotationCommentProjectionService(controller.asController());

		service.refresh(createProjection('e:/source/one', 'src/one.ts', 'annotation-one'));

		const thread = controller.createdThreads[0];
		assert.ok(thread !== undefined, 'Expected a thread to be created');
		assert.strictEqual(service.getAnnotationId(thread), 'annotation-one');

		// Refreshing the same workspace disposes the old thread and clears the map.
		service.refresh(createProjection('e:/source/one', 'src/one.ts', 'annotation-one-next'));

		assert.strictEqual(service.getAnnotationId(thread), undefined);

		service.dispose();
	});

	// Scenario: Given comment projection is configured to show all sessions, When refresh runs with the default controller path, Then inactive-session annotations are also projected.
	test('projects non-active session comments when showOnlyActiveSession is disabled', () => {
		const controller = new FakeCommentController();
		const originalCreateController = vscode.comments.createCommentController;
		const originalGetConfiguration = vscode.workspace.getConfiguration;
		(vscode.comments as unknown as { createCommentController: typeof vscode.comments.createCommentController }).createCommentController =
			() => controller.asController();
		(vscode.workspace as unknown as { getConfiguration: typeof vscode.workspace.getConfiguration }).getConfiguration =
			() => ({
				get: <T>(_section: string, _defaultValue: T) => false as T,
			}) as ReturnType<typeof vscode.workspace.getConfiguration>;

		try {
			const service = new AnnotationCommentProjectionService();
			const projection = createProjection('e:/source/one', 'src/one.ts', 'annotation-active');
			const inactiveAnnotation = {
				...projection.annotations[0],
				annotationId: 'annotation-inactive',
				filePath: 'src/two.ts',
				isActiveSession: false,
				sessionId: 'session-2',
				sessionName: 'Bug bash',
			};

			service.refresh({
				...projection,
				annotations: [projection.annotations[0], inactiveAnnotation],
				activeAnnotations: [projection.activeAnnotations[0]],
			});

			assert.strictEqual(controller.createdThreads.length, 2);
			assert.strictEqual(controller.threads[0]?.label, 'AI Toolkit · Security pass');
			assert.strictEqual(controller.threads[1]?.label, 'AI Toolkit · Bug bash');
			assert.strictEqual(service.getAnnotationId(controller.createdThreads[1] as vscode.CommentThread), 'annotation-inactive');

			service.dispose();
		} finally {
			(vscode.comments as unknown as { createCommentController: typeof vscode.comments.createCommentController }).createCommentController = originalCreateController;
			(vscode.workspace as unknown as { getConfiguration: typeof vscode.workspace.getConfiguration }).getConfiguration = originalGetConfiguration;
		}
	});

		// Scenario: Given dismissed annotations in the projection, When comment threads refresh, Then only non-dismissed entries are projected because the comments surface stays derived from store state.
		test('refresh skips dismissed annotations while projecting active and resolved entries', () => {
			const controller = new FakeCommentController();
			const service = new AnnotationCommentProjectionService(controller.asController());
			const activeProjection = createProjection('e:/source/one', 'src/one.ts', 'annotation-active', 'active');
			const resolvedProjection = createProjection('e:/source/one', 'src/two.ts', 'annotation-resolved', 'resolved');
			const dismissedProjection = createProjection('e:/source/one', 'src/three.ts', 'annotation-dismissed', 'dismissed');

			service.refresh({
				...activeProjection,
				annotations: [
					activeProjection.annotations[0],
					resolvedProjection.annotations[0],
					dismissedProjection.annotations[0],
				],
				activeAnnotations: [
					activeProjection.activeAnnotations[0],
					resolvedProjection.activeAnnotations[0],
					dismissedProjection.activeAnnotations[0],
				],
			});

			assert.strictEqual(controller.createdThreads.length, 2);
			assert.strictEqual(controller.threads[0]?.state, vscode.CommentThreadState.Unresolved);
			assert.strictEqual(controller.threads[1]?.state, vscode.CommentThreadState.Resolved);

			service.dispose();
		});
});

function createProjection(
	workspaceFolderPath: string,
	filePath: string,
	annotationId: string,
	status: 'active' | 'resolved' | 'dismissed' = 'active',
): AnnotationWorkspaceProjection {
	const annotation = {
		annotationId,
		sessionId: 'session-1',
		sessionName: 'Security pass',
		status,
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
	public readonly createdThreads: vscode.CommentThread[] = [];
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
				const threadObj = thread.asThread();
				this.threads.push(thread);
				controller.createdThreads.push(threadObj);
				return threadObj;
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
	public state: vscode.CommentThreadState | undefined;

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
			get state() {
				return thread.state;
			},
			set state(value) {
				thread.state = value;
			},
			dispose: () => {
				thread.disposed = true;
			},
		} as vscode.CommentThread;
	}
}