import * as vscode from 'vscode';
import type { AnnotationProjectionEntry } from '../application/projectionModel';

export type ExistingAnnotationAction = 'edit' | 'dismiss' | 'reanchor';

export interface AnnotationInputService {
	promptForAnnotationBody(initialValue?: string): Promise<string | undefined>;
	pickExistingAnnotationAction(annotation: AnnotationProjectionEntry): Promise<ExistingAnnotationAction | undefined>;
	confirmPurgeDismissed(count: number): Promise<boolean>;
	confirmReanchor(): Promise<boolean>;
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
		pickExistingAnnotationAction: async (annotation) => {
			const selection = await windowApi.showQuickPick(
				[
					{
						label: 'Edit annotation body',
						description: annotation.status === 'dismissed' ? 'Currently dismissed' : undefined,
						action: 'edit' as const,
					},
					{
						label: 'Dismiss annotation',
						action: 'dismiss' as const,
					},
					{
						label: 'Reanchor annotation',
						action: 'reanchor' as const,
					},
				],
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
	};
}