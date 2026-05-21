import * as vscode from 'vscode';
import type { AnnotationWorkspaceServiceLike } from '../application/annotationWorkspaceService';
import { findAnnotationForEditorSelection, toWorkspaceRelativeFilePath } from '../presentation/annotationTargeting';
import { findWorkspaceFolderForEditor } from '../util/workspaceFolders';

export const annotationContextKeyIds = {
	canManage: 'aiToolkit.annotation.canManage',
	hasActiveSession: 'aiToolkit.annotation.hasActiveSession',
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

	const setSafeDefaults = async () => {
		await commandsApi.executeCommand('setContext', annotationContextKeyIds.canManage, false);
		await commandsApi.executeCommand('setContext', annotationContextKeyIds.hasActiveSession, false);
	};

	const refresh = async () => {
		const editor = windowApi.activeTextEditor;
		const workspaceFolder = findWorkspaceFolderForEditor(editor);

		if (!editor || !workspaceFolder) {
			await setSafeDefaults();
			return;
		}

		const filePath = toWorkspaceRelativeFilePath(workspaceFolder, editor.document.uri);

		if (!filePath) {
			await setSafeDefaults();
			return;
		}

		const service = await dependencies.getWorkspaceService(workspaceFolder);
		const state = service.getState() ?? (await service.initialize());

		if (state.status !== 'ready') {
			await setSafeDefaults();
			return;
		}

		const target = findAnnotationForEditorSelection(state.projection.annotations, filePath, editor.selection);
		await commandsApi.executeCommand('setContext', annotationContextKeyIds.canManage, Boolean(target));
		await commandsApi.executeCommand('setContext', annotationContextKeyIds.hasActiveSession, Boolean(state.projection.activeSessionId));
	};

	const safeRefresh = async () => {
		try {
			await refresh();
		} catch {
			await setSafeDefaults();
		}
	};

	disposables.push(windowApi.onDidChangeActiveTextEditor(() => void safeRefresh()));
	disposables.push(windowApi.onDidChangeTextEditorSelection(() => void safeRefresh()));
	void safeRefresh();

	return {
		refresh: safeRefresh,
		dispose: () => {
			for (const disposable of disposables) {
				disposable.dispose();
			}
		},
	};
}