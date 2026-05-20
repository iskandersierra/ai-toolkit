import * as path from 'node:path';
import * as vscode from 'vscode';
import type {
	AnnotationProjectionEntry,
	AnnotationWorkspaceProjection,
} from '../application/projectionModel';

export class AnnotationCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
	private readonly onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();
	public readonly onDidChangeCodeLenses = this.onDidChangeCodeLensesEmitter.event;

	private readonly entriesByWorkspace = new Map<string, AnnotationProjectionEntry[]>();

	public refresh(projection: AnnotationWorkspaceProjection): void {
		this.entriesByWorkspace.set(projection.workspaceFolderPath, projection.activeAnnotations.filter(
			(entry) => entry.status !== 'dismissed',
		));
		this.onDidChangeCodeLensesEmitter.fire();
	}

	public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
		const matching = this.getMatchingEntries(document.uri.fsPath);

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
		this.entriesByWorkspace.clear();
		this.onDidChangeCodeLensesEmitter.dispose();
	}

	private getMatchingEntries(documentPath: string): AnnotationProjectionEntry[] {
		for (const [workspaceFolderPath, entries] of this.entriesByWorkspace) {
			const documentRelativePath = path
				.relative(workspaceFolderPath, documentPath)
				.replace(/\\/g, '/');

			if (documentRelativePath.startsWith('../') || path.isAbsolute(documentRelativePath)) {
				continue;
			}

			return entries.filter((entry) => entry.filePath === documentRelativePath);
		}

		return [];
	}
}
