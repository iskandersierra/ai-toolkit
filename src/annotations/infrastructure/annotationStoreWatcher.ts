import * as vscode from 'vscode';
import { annotationStoreRelativePath } from '../domain/annotationSchema';
import {
	createAnnotationLogger,
	logAnnotationStoreReload,
	type AnnotationLogger,
} from '../util/log';

export type AnnotationStoreChangeKind = 'created' | 'changed' | 'deleted';

export interface AnnotationStoreChangeEvent {
	kind: AnnotationStoreChangeKind;
	uri: vscode.Uri;
}

export class AnnotationStoreWatcher implements vscode.Disposable {
	private readonly watcher: vscode.FileSystemWatcher;

	public constructor(
		workspaceFolder: vscode.WorkspaceFolder,
		onChange: (event: AnnotationStoreChangeEvent) => void,
		private readonly logger: AnnotationLogger = createAnnotationLogger(),
	) {
		this.watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(workspaceFolder, annotationStoreRelativePath),
		);

		this.watcher.onDidCreate((uri) => {
			logAnnotationStoreReload(this.logger, uri.fsPath, 'created');
			onChange({ kind: 'created', uri });
		});
		this.watcher.onDidChange((uri) => {
			logAnnotationStoreReload(this.logger, uri.fsPath, 'changed');
			onChange({ kind: 'changed', uri });
		});
		this.watcher.onDidDelete((uri) => {
			logAnnotationStoreReload(this.logger, uri.fsPath, 'deleted');
			onChange({ kind: 'deleted', uri });
		});
	}

	public dispose(): void {
		this.watcher.dispose();
	}
	}