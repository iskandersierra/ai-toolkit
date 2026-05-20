import * as vscode from 'vscode';
import type { AnnotationWorkspaceServiceLike } from '../application/annotationWorkspaceService';
import { findAnnotationForEditorSelection, toWorkspaceRelativeFilePath } from '../presentation/annotationTargeting';
import { findWorkspaceFolderForEditor } from '../util/workspaceFolders';

export const annotationContextKeyIds = {
	canManage: 'aiToolkit.annotation.canManage',
} as const;

export interface AnnotationContextKeyDependencies {
	getWorkspaceService(workspaceFolder: vscode.WorkspaceFolder): Promise<AnnotationWorkspaceServiceLike>;
	window?: Pick<typeof vscode.window, 'activeTextEditor' | 'onDidChangeActiveTextEditor' | 'onDidChangeTextEditorSelection'>;
	commands?: Pick<typeof vscode.commands, 'executeCommand'>;
}

export interface AnnotationContextKeyController {
	refresh(): Promise<void>;
	dispose(): void;
}

export function registerAnnotationContextKeys(
	context: vscode.ExtensionContext,
	dependencies: AnnotationContextKeyDependencies,
): AnnotationContextKeyController {
	const windowApi = dependencies.window ?? vscode.window;
	const commandsApi = dependencies.commands ?? vscode.commands;
	const disposables: vscode.Disposable[] = [];

	const refresh = async () => {
		const editor = windowApi.activeTextEditor;
		const workspaceFolder = findWorkspaceFolderForEditor(editor);

		if (!editor || !workspaceFolder) {
			await commandsApi.executeCommand('setContext', annotationContextKeyIds.canManage, false);
			return;
		}

		const filePath = toWorkspaceRelativeFilePath(workspaceFolder, editor.document.uri);

		if (!filePath) {
			await commandsApi.executeCommand('setContext', annotationContextKeyIds.canManage, false);
			return;
		}

		const service = await dependencies.getWorkspaceService(workspaceFolder);
		const state = service.getState() ?? (await service.initialize());

		if (state.status !== 'ready') {
			await commandsApi.executeCommand('setContext', annotationContextKeyIds.canManage, false);
			return;
		}

		const target = findAnnotationForEditorSelection(state.projection.annotations, filePath, editor.selection);
		await commandsApi.executeCommand('setContext', annotationContextKeyIds.canManage, Boolean(target));
	};

	disposables.push(windowApi.onDidChangeActiveTextEditor(() => void refresh()));
	disposables.push(windowApi.onDidChangeTextEditorSelection(() => void refresh()));
	context.subscriptions.push(...disposables);
	void refresh();

	return {
		refresh,
		dispose: () => {
			for (const disposable of disposables) {
				disposable.dispose();
			}
		},
	};
}