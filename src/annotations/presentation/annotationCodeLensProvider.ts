import * as path from 'node:path';
import * as vscode from 'vscode';
import type {
	AnnotationProjectionEntry,
	AnnotationWorkspaceProjection,
} from '../application/projectionModel';

export class AnnotationCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
	private readonly onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();
	public readonly onDidChangeCodeLenses = this.onDidChangeCodeLensesEmitter.event;

	private entries: AnnotationProjectionEntry[] = [];
	private workspaceFolderPath = '';

	public refresh(projection: AnnotationWorkspaceProjection): void {
		this.workspaceFolderPath = projection.workspaceFolderPath;
		this.entries = projection.activeAnnotations.filter(
			(entry) => entry.status !== 'dismissed',
		);
		this.onDidChangeCodeLensesEmitter.fire();
	}

	public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
		const documentRelativePath = path
			.relative(this.workspaceFolderPath, document.uri.fsPath)
			.replace(/\\/g, '/');

		const matching = this.entries.filter(
			(entry) => entry.filePath === documentRelativePath,
		);

		const lenses: vscode.CodeLens[] = [];

		for (const entry of matching) {
			const range = new vscode.Range(
				entry.range.start.line,
				entry.range.start.character,
				entry.range.end.line,
				entry.range.end.character,
			);

			lenses.push(
				new vscode.CodeLens(range, {
					title: 'Edit Annotation',
					command: 'ai-toolkit.addOrEditAnnotation',
					arguments: [{ annotationId: entry.annotationId }],
				}),
			);

			if (entry.anchorState === 'orphaned') {
				lenses.push(
					new vscode.CodeLens(range, {
						title: '⚠ Orphaned',
						command: '',
					}),
				);
			}
		}

		return lenses;
	}

	public dispose(): void {
		this.onDidChangeCodeLensesEmitter.dispose();
	}
}
