import * as vscode from 'vscode';

export function findWorkspaceFolderForEditor(
	editor: vscode.TextEditor | undefined,
): vscode.WorkspaceFolder | undefined {
	if (editor?.document.uri.scheme === 'file') {
		return vscode.workspace.getWorkspaceFolder(editor.document.uri);
	}

	return undefined;
}

export function findWorkspaceFolderForPaletteCommand(): vscode.WorkspaceFolder | undefined {
	const workspaceFolders = vscode.workspace.workspaceFolders;

	if (!workspaceFolders || workspaceFolders.length !== 1) {
		return undefined;
	}

	return workspaceFolders[0];
}