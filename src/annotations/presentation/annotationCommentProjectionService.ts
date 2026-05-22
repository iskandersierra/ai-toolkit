import * as path from 'node:path';
import * as vscode from 'vscode';
import type {
	AnnotationProjectionEntry,
	AnnotationWorkspaceProjection,
} from '../application/projectionModel';

export class AnnotationCommentProjectionService implements vscode.Disposable {
	private readonly controller: vscode.CommentController;
	private readonly threadsByWorkspace = new Map<string, vscode.CommentThread[]>();
	private readonly threadAnnotationIds = new Map<vscode.CommentThread, string>();

	constructor(controller?: vscode.CommentController) {
		this.controller = controller ?? vscode.comments.createCommentController(
			'ai-toolkit-annotations',
			'AI Toolkit',
		);
	}

	public refresh(projection: AnnotationWorkspaceProjection): void {
		this.disposeWorkspaceThreads(projection.workspaceFolderPath);
		const showOnlyActive = vscode.workspace
			.getConfiguration('aiToolkit.comments')
			.get<boolean>('showOnlyActiveSession', true);

		const entries = showOnlyActive
			? projection.activeAnnotations
			: projection.annotations;

		const visibleEntries = entries.filter((entry) => entry.status !== 'dismissed');

		for (const entry of visibleEntries) {
			this.createThread(entry, projection.workspaceFolderPath);
		}
	}

	public getAnnotationId(thread: vscode.CommentThread): string | undefined {
		return this.threadAnnotationIds.get(thread);
	}

	public dispose(): void {
		for (const workspaceFolderPath of this.threadsByWorkspace.keys()) {
			this.disposeWorkspaceThreads(workspaceFolderPath);
		}

		this.controller.dispose();
	}

	private createThread(
		entry: AnnotationProjectionEntry,
		workspaceFolderPath: string,
	): void {
		const uri = vscode.Uri.file(path.join(workspaceFolderPath, entry.filePath));
		const range = new vscode.Range(
			entry.range.start.line,
			entry.range.start.character,
			entry.range.end.line,
			entry.range.end.character,
		);

		const thread = this.controller.createCommentThread(uri, range, []);

		thread.canReply = false;
		thread.label = `AI Toolkit · ${entry.sessionName}`;
		thread.contextValue = `ai-toolkit:${entry.sessionId}:${entry.annotationId}`;

		const comment: vscode.Comment = {
			body: entry.body,
			author: { name: entry.sessionName },
			mode: vscode.CommentMode.Preview,
		};

		thread.comments = [comment];
		thread.state = entry.status === 'resolved'
			? vscode.CommentThreadState.Resolved
			: vscode.CommentThreadState.Unresolved;
		this.threadAnnotationIds.set(thread, entry.annotationId);
		const workspaceThreads = this.threadsByWorkspace.get(workspaceFolderPath) ?? [];
		workspaceThreads.push(thread);
		this.threadsByWorkspace.set(workspaceFolderPath, workspaceThreads);
	}

	private disposeWorkspaceThreads(workspaceFolderPath: string): void {
		const threads = this.threadsByWorkspace.get(workspaceFolderPath) ?? [];

		for (const thread of threads) {
			this.threadAnnotationIds.delete(thread);
			thread.dispose();
		}

		this.threadsByWorkspace.delete(workspaceFolderPath);
	}
}
