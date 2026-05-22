import * as vscode from 'vscode';
import type { AnnotationWorkspaceServiceLike } from '../application/annotationWorkspaceService';
import { resolveAnnotationTarget, toWorkspaceRelativeFilePath } from '../presentation/annotationTargeting';
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
	let latestRefreshToken = 0;

	const applyContextState = async (refreshToken: number, canManage: boolean, hasActiveSession: boolean) => {
		if (refreshToken !== latestRefreshToken) {
			return;
		}

		await commandsApi.executeCommand('setContext', annotationContextKeyIds.canManage, canManage);

		if (refreshToken !== latestRefreshToken) {
			return;
		}

		await commandsApi.executeCommand('setContext', annotationContextKeyIds.hasActiveSession, hasActiveSession);
	};

	const setSafeDefaults = async (refreshToken: number) => {
		await commandsApi.executeCommand('setContext', annotationContextKeyIds.canManage, false);

		if (refreshToken !== latestRefreshToken) {
			return;
		}

		await commandsApi.executeCommand('setContext', annotationContextKeyIds.hasActiveSession, false);
	};

	const refresh = async (refreshToken: number) => {
		const editor = windowApi.activeTextEditor;
		const workspaceFolder = findWorkspaceFolderForEditor(editor);

		if (!editor || !workspaceFolder) {
			await setSafeDefaults(refreshToken);
			return;
		}

		const filePath = toWorkspaceRelativeFilePath(workspaceFolder, editor.document.uri);

		if (!filePath) {
			await setSafeDefaults(refreshToken);
			return;
		}

		const service = await dependencies.getWorkspaceService(workspaceFolder);
		const state = service.getState() ?? (await service.initialize());

		if (state.status !== 'ready') {
			await setSafeDefaults(refreshToken);
			return;
		}

		const target = resolveAnnotationTarget(state.projection.annotations, filePath, editor.selection);
		await applyContextState(
			refreshToken,
			target.kind === 'found',
			Boolean(state.projection.activeSessionId),
		);
	};

	const safeRefresh = async () => {
		const refreshToken = ++latestRefreshToken;

		try {
			await refresh(refreshToken);
		} catch {
			await setSafeDefaults(refreshToken);
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