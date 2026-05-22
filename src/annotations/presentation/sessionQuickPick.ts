import * as vscode from 'vscode';
import type { AnnotationWorkspaceProjection } from '../application/projectionModel';

export type SessionQuickPickItem =
	| {
		type: 'session';
		sessionId: string;
		label: string;
		description?: string;
		detail?: string;
	}
	| {
		type: 'create';
		label: string;
		description?: string;
		detail?: string;
	};

export interface SessionQuickPickPresenter {
	pickSession(items: readonly SessionQuickPickItem[]): Promise<SessionQuickPickItem | undefined>;
	promptForNewSessionName(suggestedName: string): Promise<string | undefined>;
}

export function createSessionQuickPickItems(
	projection: AnnotationWorkspaceProjection,
): SessionQuickPickItem[] {
	const sessionItems: SessionQuickPickItem[] = projection.sessions.map((session) => ({
		type: 'session',
		sessionId: session.sessionId,
		label: session.name,
		description: session.isActive ? 'Active session' : undefined,
		detail: `${session.annotationCount} annotations, ${session.dismissedCount} dismissed`,
	}));

	return [
		...sessionItems,
		{
			type: 'create',
			label: 'Create new session...',
			detail: 'Create and activate a new review session.',
		},
	];
}

export function createVscodeSessionQuickPickPresenter(
	windowApi: Pick<typeof vscode.window, 'showQuickPick' | 'showInputBox'> = vscode.window,
): SessionQuickPickPresenter {
	return {
		pickSession: async (items) => {
			const selected = await windowApi.showQuickPick(
				items.map((item) => ({
					...item,
					picked: item.type === 'session' && item.description === 'Active session',
				})),
				{
					title: 'AI Toolkit: Select Review Session',
					placeHolder: 'Choose the active review session.',
					ignoreFocusOut: true,
				},
			);

			return selected ? toSessionQuickPickItem(selected) : undefined;
		},
		promptForNewSessionName: async (suggestedName) =>
			windowApi.showInputBox({
				title: 'AI Toolkit: Create Review Session',
				prompt: 'Enter a review session name.',
				value: suggestedName,
				ignoreFocusOut: true,
				validateInput: (value) =>
					value.trim().length === 0 ? 'Review session name is required.' : undefined,
			}),
	};
}

function toSessionQuickPickItem(item: vscode.QuickPickItem & { type: 'session' | 'create'; sessionId?: string }): SessionQuickPickItem {
	if (item.type === 'create') {
		return {
			type: 'create',
			label: item.label,
			description: item.description,
			detail: item.detail,
		};
	}

	return {
		type: 'session',
		sessionId: item.sessionId ?? '',
		label: item.label,
		description: item.description,
		detail: item.detail,
	};
}