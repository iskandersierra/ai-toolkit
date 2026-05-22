import * as vscode from 'vscode';
import type { AnnotationSessionProjection } from '../application/projectionModel';

export type SessionMaintenanceOperation = 'delete' | 'clear';

export interface SessionMaintenanceQuickPickItem {
	type: 'session';
	sessionId: string;
	label: string;
	isActive: boolean;
	description?: string;
	detail: string;
	annotationCount: number;
	updatedAt: string;
}

export interface SessionMaintenanceQuickPickPresenter {
	pickSession(
		operation: SessionMaintenanceOperation,
		items: readonly SessionMaintenanceQuickPickItem[],
	): Promise<SessionMaintenanceQuickPickItem | undefined>;
}

export function createSessionMaintenanceQuickPickItems(
	sessions: readonly AnnotationSessionProjection[],
): SessionMaintenanceQuickPickItem[] {
	return [...sessions]
		.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
		.map((session) => ({
			type: 'session',
			sessionId: session.sessionId,
			label: session.name,
			isActive: session.isActive,
			description: session.isActive ? 'Active session' : undefined,
			detail: `${session.annotationCount} annotations, ${session.dismissedCount} dismissed, updated ${session.updatedAt}`,
			annotationCount: session.annotationCount,
			updatedAt: session.updatedAt,
		}));
}

export function createVscodeSessionMaintenanceQuickPickPresenter(
	windowApi: Pick<typeof vscode.window, 'showQuickPick'> = vscode.window,
): SessionMaintenanceQuickPickPresenter {
	return {
		pickSession: async (operation, items) => {
			const selected = await windowApi.showQuickPick(items, {
				title: operation === 'delete' ? 'AI Toolkit: Delete Review Session' : 'AI Toolkit: Clear Review Session Annotations',
				placeHolder: operation === 'delete'
					? 'Choose the review session to delete.'
					: 'Choose the review session to clear.',
				ignoreFocusOut: true,
			});

			return selected ? { ...selected } : undefined;
		},
	};
}