import * as path from 'node:path';
import * as vscode from 'vscode';
import type {
	AnnotationProjectionEntry,
	AnnotationWorkspaceProjection,
} from '../application/projectionModel';

export class AnnotationCommentProjectionService implements vscode.Disposable {
	private readonly controller: vscode.CommentController;
	private readonly threads: vscode.CommentThread[] = [];

	constructor() {
		this.controller = vscode.comments.createCommentController(
			'ai-toolkit-annotations',
			'AI Toolkit',
		);
	}

	public refresh(projection: AnnotationWorkspaceProjection): void {
		this.disposeThreads();

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

	public dispose(): void {
		this.disposeThreads();
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
		this.threads.push(thread);
	}

	private disposeThreads(): void {
		for (const thread of this.threads) {
			thread.dispose();
		}

		this.threads.length = 0;
	}
}
