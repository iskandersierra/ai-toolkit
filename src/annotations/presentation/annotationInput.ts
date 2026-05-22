import * as vscode from 'vscode';
import type { AnnotationProjectionEntry } from '../application/projectionModel';

export type ExistingAnnotationAction = 'edit' | 'dismiss' | 'reanchor' | 'resolve' | 'reopen';

export interface AnnotationInputService {
	promptForAnnotationBody(initialValue?: string): Promise<string | undefined>;
	pickExistingAnnotationAction(
		annotation: AnnotationProjectionEntry,
		availableActions: ExistingAnnotationAction[],
	): Promise<ExistingAnnotationAction | undefined>;
	confirmPurgeDismissed(count: number): Promise<boolean>;
	confirmReanchor(): Promise<boolean>;
	confirmDeleteSession?(sessionName: string, annotationCount: number, isActiveSession: boolean): Promise<boolean>;
	confirmClearSessionAnnotations?(sessionName: string, annotationCount: number): Promise<boolean>;
}

export function createVscodeAnnotationInputService(
	windowApi: Pick<typeof vscode.window, 'showInputBox' | 'showQuickPick' | 'showWarningMessage'> = vscode.window,
): AnnotationInputService {
	return {
		promptForAnnotationBody: async (initialValue) =>
			windowApi.showInputBox({
				title: initialValue ? 'AI Toolkit: Edit Annotation' : 'AI Toolkit: Add Annotation',
				prompt: 'Enter the annotation body.',
				value: initialValue,
				ignoreFocusOut: true,
				validateInput: (value) =>
					value.trim().length === 0 ? 'Annotation body is required.' : undefined,
			}),
		pickExistingAnnotationAction: async (annotation, availableActions) => {
			const labelMap: Record<ExistingAnnotationAction, string> = {
				edit: 'Edit annotation body',
				resolve: 'Resolve annotation',
				reopen: 'Reopen annotation',
				dismiss: 'Dismiss annotation',
				reanchor: 'Reanchor annotation',
			};
			const selection = await windowApi.showQuickPick(
				availableActions.map((action) => ({
					label: labelMap[action],
					description: action === 'edit' && annotation.status === 'dismissed' ? 'Currently dismissed' : undefined,
					action,
				})),
				{
					title: 'AI Toolkit: Add or Edit Annotation',
					placeHolder: 'Choose how to manage the selected annotation.',
					ignoreFocusOut: true,
				},
			);

			return selection?.action;
		},
		confirmPurgeDismissed: async (count) => {
			const choice = await windowApi.showWarningMessage(
				`Purge ${count} dismissed annotation${count === 1 ? '' : 's'} from the active review session?`,
				{ modal: true },
				'Purge',
			);

			return choice === 'Purge';
		},
		confirmReanchor: async () => {
			const choice = await windowApi.showWarningMessage(
				'Reanchor the selected annotation to the current editor selection?',
				{ modal: true },
				'Reanchor',
			);

			return choice === 'Reanchor';
		},
		confirmDeleteSession: async (sessionName, annotationCount, isActiveSession) => {
			const choice = await windowApi.showWarningMessage(
				`${isActiveSession ? 'This is the active review session. ' : ''}Delete review session "${sessionName}" and remove its ${annotationCount} annotation${annotationCount === 1 ? '' : 's'}?`,
				{ modal: true },
				'Delete Session',
			);

			return choice === 'Delete Session';
		},
		confirmClearSessionAnnotations: async (sessionName, annotationCount) => {
			const choice = await windowApi.showWarningMessage(
				`Clear ${annotationCount} annotation${annotationCount === 1 ? '' : 's'} from review session "${sessionName}"?`,
				{ modal: true },
				'Clear Annotations',
			);

			return choice === 'Clear Annotations';
		},
	};
}