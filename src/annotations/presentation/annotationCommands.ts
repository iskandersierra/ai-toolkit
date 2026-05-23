import * as vscode from 'vscode';
import {
	type AnnotationAnchor,
} from '../domain/annotationModels';
import { validateNewAnnotationSelectedLines } from '../domain/annotationValidation';
import type {
	AnnotationWorkspaceBlockedReason,
	AnnotationWorkspaceMutationResult,
	AnnotationWorkspaceReadyState,
	AnnotationWorkspaceServiceLike,
} from '../application/annotationWorkspaceService';
import { SessionSelectionService } from '../application/sessionSelectionService';
import type { AnnotationProjectionEntry } from '../application/projectionModel';
import type { AnnotationContextKeyController } from '../bootstrap/annotationContextKeys';
import type { AnnotationCommentProjectionService } from './annotationCommentProjectionService';
import { createVscodeAnnotationInputService, type AnnotationInputService, type ExistingAnnotationAction } from './annotationInput';
import {
	createSessionMaintenanceQuickPickItems,
	createVscodeSessionMaintenanceQuickPickPresenter,
	type SessionMaintenanceOperation,
	type SessionMaintenanceQuickPickPresenter,
} from './sessionMaintenanceQuickPick';
import {
	createAnchorFromEditorSelection,
	resolveAnnotationTarget,
	toWorkspaceRelativeFilePath,
} from './annotationTargeting';
import {
	findWorkspaceFolderForEditor,
	findWorkspaceFolderForPaletteCommand,
} from '../util/workspaceFolders';
import { generateDraftContent } from '../application/draftOutputService';
import type { DraftOutputFormat } from '../domain/draftShapes';
import { createAnnotationLogger } from '../util/log';

const logger = createAnnotationLogger();
const maxAnnotationSelectionLines = 50;

export const annotationCommandIds = {
	addOrEditAnnotation: 'ai-toolkit.addOrEditAnnotation',
	selectReviewSession: 'ai-toolkit.selectReviewSession',
	generateDraftOutput: 'ai-toolkit.generateDraftOutput',
	purgeDismissedAnnotations: 'ai-toolkit.purgeDismissedAnnotations',
	deleteReviewSession: 'ai-toolkit.deleteReviewSession',
	clearReviewSessionAnnotations: 'ai-toolkit.clearReviewSessionAnnotations',
	reanchorAnnotation: 'ai-toolkit.reanchorAnnotation',
	dismissAnnotation: 'ai-toolkit.dismissAnnotation',
	resolveAnnotation: 'ai-toolkit.resolveAnnotation',
	reopenAnnotation: 'ai-toolkit.reopenAnnotation',
} as const;

const annotationCommentContextTokens = {
	controller: 'ai-toolkit-annotation',
	statusPrefix: 'status:',
	actionPrefix: 'action:',
} as const;

export type AnnotationCommandId = typeof annotationCommandIds[keyof typeof annotationCommandIds];

export type AnnotationCommandBlockedReason =
	| 'noWorkspaceFolder'
	| 'noReviewSessions'
	| 'noEditorSelection'
	| 'invalidSelection'
	| 'annotationNotFound'
	| 'documentOpenFailed'
	| 'cancelled'
	| AnnotationWorkspaceBlockedReason;

export type AnnotationCommandResult =
	| {
		status: 'ready';
		commandId: AnnotationCommandId;
		workspaceFolder: string;
		operation:
			| 'annotationCreated'
			| 'annotationUpdated'
			| 'annotationDismissed'
			| 'annotationResolved'
			| 'annotationReopened'
			| 'annotationReanchored'
			| 'reviewSessionSelected'
			| 'reviewSessionDeleted'
			| 'reviewSessionAnnotationsCleared'
			| 'dismissedAnnotationsPurged'
			| 'draftOutputGenerated';
		annotationId?: string;
		sessionId?: string;
		purgedCount?: number;
	}
	| {
		status: 'blocked';
		commandId: AnnotationCommandId;
		reason: AnnotationCommandBlockedReason;
		message: string;
		workspaceFolder?: string;
	}
	| {
		status: 'cancelled';
		commandId: AnnotationCommandId;
		workspaceFolder?: string;
	};

export interface AnnotationCommandDependencies {
	window?: Pick<
		typeof vscode.window,
		'activeTextEditor' | 'showErrorMessage' | 'showInformationMessage' | 'showWarningMessage' | 'showTextDocument'
	>;
	workspace?: Pick<typeof vscode.workspace, 'getConfiguration' | 'openTextDocument'>;
	commands?: Pick<typeof vscode.commands, 'registerCommand'>;
	inputService?: AnnotationInputService;
	sessionMaintenancePresenter?: SessionMaintenanceQuickPickPresenter;
	sessionSelectionService: SessionSelectionService;
	getWorkspaceService(workspaceFolder: vscode.WorkspaceFolder): Promise<AnnotationWorkspaceServiceLike>;
	contextKeys?: AnnotationContextKeyController;
	commentProjection?: Pick<AnnotationCommentProjectionService, 'getAnnotationId'>;
}

type AnnotationCommandArguments =
	| {
		annotationId?: string;
	}
	| vscode.CommentThread
	| vscode.Comment;

export function registerAnnotationCommands(
	context: vscode.ExtensionContext,
	dependencies: AnnotationCommandDependencies,
): void {
	const commands = dependencies.commands ?? vscode.commands;

	context.subscriptions.push(
		commands.registerCommand(annotationCommandIds.addOrEditAnnotation, (args?: AnnotationCommandArguments) =>
			executeAddOrEditAnnotationCommand(dependencies, args),
		),
		commands.registerCommand(annotationCommandIds.selectReviewSession, () =>
			executeSelectReviewSessionCommand(dependencies),
		),
		commands.registerCommand(annotationCommandIds.generateDraftOutput, () =>
			executeGenerateDraftOutputCommand(dependencies),
		),
		commands.registerCommand(annotationCommandIds.purgeDismissedAnnotations, () =>
			executePurgeDismissedAnnotationsCommand(dependencies),
		),
		commands.registerCommand(annotationCommandIds.deleteReviewSession, () =>
			executeDeleteReviewSessionCommand(dependencies),
		),
		commands.registerCommand(annotationCommandIds.clearReviewSessionAnnotations, () =>
			executeClearReviewSessionAnnotationsCommand(dependencies),
		),
		commands.registerCommand(annotationCommandIds.reanchorAnnotation, (args?: AnnotationCommandArguments) =>
			executeReanchorAnnotationCommand(dependencies, args),
		),
		commands.registerCommand(annotationCommandIds.dismissAnnotation, (args?: AnnotationCommandArguments) =>
			executeDismissAnnotationCommand(dependencies, args),
		),
		commands.registerCommand(annotationCommandIds.resolveAnnotation, (args?: AnnotationCommandArguments) =>
			executeResolveAnnotationCommand(dependencies, args),
		),
		commands.registerCommand(annotationCommandIds.reopenAnnotation, (args?: AnnotationCommandArguments) =>
			executeReopenAnnotationCommand(dependencies, args),
		),
	);
}

export async function executeAddOrEditAnnotationCommand(
	dependencies: AnnotationCommandDependencies,
	args?: AnnotationCommandArguments,
): Promise<AnnotationCommandResult> {
	const windowApi = dependencies.window ?? vscode.window;
	const workspaceApi = dependencies.workspace ?? vscode.workspace;
	const editor = windowApi.activeTextEditor;
	const thread = extractCommentThread(args);
	const workspaceFolder = resolveEditorWorkspaceFolder(editor);

	if (!workspaceFolder || !editor) {
		return blockWithoutWorkspace(windowApi, annotationCommandIds.addOrEditAnnotation);
	}

	const service = await dependencies.getWorkspaceService(workspaceFolder);
	const relativePath = toWorkspaceRelativeFilePath(workspaceFolder, editor.document.uri);

	if (!relativePath) {
		return blockWithoutWorkspace(windowApi, annotationCommandIds.addOrEditAnnotation);
	}

	const readyState = await ensureReadyState(service);

	if (isWorkspaceBlocked(readyState)) {
		return reportWorkspaceBlocked(
			annotationCommandIds.addOrEditAnnotation,
			readyState,
			windowApi,
			workspaceFolder.uri.fsPath,
			workspaceApi,
		);
	}

	const explicitAnnotationId = resolveCommandArgumentAnnotationId(args, dependencies.commentProjection);

	if (explicitAnnotationId) {
		const target = readyState.projection.annotations.find(
			(annotation) => annotation.annotationId === explicitAnnotationId,
		);
		if (target) {
			return executeExistingAnnotationAction(dependencies, workspaceFolder, editor, target, {
				allowReanchor: !thread,
			});
		}
	} else {
		const targetResult = resolveAnnotationTarget(
			readyState.projection.annotations,
			relativePath,
			editor.selection,
		);
		if (targetResult.kind === 'found') {
			return executeExistingAnnotationAction(dependencies, workspaceFolder, editor, targetResult.annotation);
		}
		if (targetResult.kind === 'conflict') {
			void windowApi.showWarningMessage('The selection overlaps multiple annotations. Narrow the selection to a single annotation.');
			return {
				status: 'blocked',
				commandId: annotationCommandIds.addOrEditAnnotation,
				reason: 'invalidSelection',
				message: 'The selection overlaps multiple annotations. Narrow the selection to a single annotation.',
				workspaceFolder: workspaceFolder.uri.fsPath,
			};
		}
	}

	if (editor.selection.isEmpty) {
		void windowApi.showWarningMessage('Select code or place the cursor on an existing annotated range.');
		return {
			status: 'blocked',
			commandId: annotationCommandIds.addOrEditAnnotation,
			reason: 'noEditorSelection',
			message: 'Select code or place the cursor on an existing annotated range.',
			workspaceFolder: workspaceFolder.uri.fsPath,
		};
	}

	const anchor = createAnchorFromEditorSelection(editor);
	const validation = validateSelection(editor.selection, anchor);

	if (validation) {
		void windowApi.showErrorMessage(validation);
		return {
			status: 'blocked',
			commandId: annotationCommandIds.addOrEditAnnotation,
			reason: 'invalidSelection',
			message: validation,
			workspaceFolder: workspaceFolder.uri.fsPath,
		};
	}

	const ensuredSession = await dependencies.sessionSelectionService.ensureActiveSession(service);

	if (ensuredSession.status === 'cancelled') {
		return { status: 'cancelled', commandId: annotationCommandIds.addOrEditAnnotation, workspaceFolder: workspaceFolder.uri.fsPath };
	}

	if (ensuredSession.status === 'blocked') {
		return reportWorkspaceBlocked(
			annotationCommandIds.addOrEditAnnotation,
			ensuredSession,
			windowApi,
			workspaceFolder.uri.fsPath,
			workspaceApi,
		);
	}

	const inputService = dependencies.inputService ?? createVscodeAnnotationInputService();
	const body = await inputService.promptForAnnotationBody();

	if (!body) {
		return { status: 'cancelled', commandId: annotationCommandIds.addOrEditAnnotation, workspaceFolder: workspaceFolder.uri.fsPath };
	}

	const result = await service.createAnnotation({ body, filePath: relativePath, anchor });
	return toMutationCommandResult(
		annotationCommandIds.addOrEditAnnotation,
		result,
		windowApi,
		workspaceFolder.uri.fsPath,
		'Annotation saved to the active review session.',
		'annotationCreated',
		dependencies.contextKeys,
	);
}

export async function executeSelectReviewSessionCommand(
	dependencies: AnnotationCommandDependencies,
): Promise<AnnotationCommandResult> {
	const windowApi = dependencies.window ?? vscode.window;
	const workspaceApi = dependencies.workspace ?? vscode.workspace;
	const workspaceFolder = resolvePaletteWorkspaceFolder(windowApi.activeTextEditor);

	if (!workspaceFolder) {
		return blockWithoutWorkspace(windowApi, annotationCommandIds.selectReviewSession);
	}

	const service = await dependencies.getWorkspaceService(workspaceFolder);
	const result = await dependencies.sessionSelectionService.selectSession(service);

	if (result.status === 'cancelled') {
		return {
			status: 'cancelled',
			commandId: annotationCommandIds.selectReviewSession,
			workspaceFolder: workspaceFolder.uri.fsPath,
		};
	}

	if (result.status === 'blocked') {
		return reportWorkspaceBlocked(
			annotationCommandIds.selectReviewSession,
			result,
			windowApi,
			workspaceFolder.uri.fsPath,
			workspaceApi,
		);
	}

	void windowApi.showInformationMessage(
		result.created
			? 'Created and activated the review session.'
			: 'Activated the selected review session.',
	);
	await refreshContextKeysBestEffort(
		dependencies.contextKeys,
		annotationCommandIds.selectReviewSession,
		workspaceFolder.uri.fsPath,
	);
	return {
		status: 'ready',
		commandId: annotationCommandIds.selectReviewSession,
		workspaceFolder: workspaceFolder.uri.fsPath,
		operation: 'reviewSessionSelected',
		sessionId: result.sessionId,
	};
}

export async function executePurgeDismissedAnnotationsCommand(
	dependencies: AnnotationCommandDependencies,
): Promise<AnnotationCommandResult> {
	const windowApi = dependencies.window ?? vscode.window;
	const workspaceApi = dependencies.workspace ?? vscode.workspace;
	const workspaceFolder = resolvePaletteWorkspaceFolder(windowApi.activeTextEditor);

	if (!workspaceFolder) {
		return blockWithoutWorkspace(windowApi, annotationCommandIds.purgeDismissedAnnotations);
	}

	const service = await dependencies.getWorkspaceService(workspaceFolder);
	const readyState = await ensureReadyState(service);

	if (isWorkspaceBlocked(readyState)) {
		return reportWorkspaceBlocked(
			annotationCommandIds.purgeDismissedAnnotations,
			readyState,
			windowApi,
			workspaceFolder.uri.fsPath,
			workspaceApi,
		);
	}

	if (!readyState.projection.activeSessionId) {
		return reportBlocked(
			annotationCommandIds.purgeDismissedAnnotations,
			workspaceFolder.uri.fsPath,
			'noActiveSession',
			'Select a review session before purging dismissed annotations.',
			windowApi,
		);
	}

	if (readyState.projection.dismissedAnnotationsInActiveSession === 0) {
		void windowApi.showInformationMessage('The active review session has no dismissed annotations to purge.');
		return {
			status: 'ready',
			commandId: annotationCommandIds.purgeDismissedAnnotations,
			workspaceFolder: workspaceFolder.uri.fsPath,
			operation: 'dismissedAnnotationsPurged',
			purgedCount: 0,
		};
	}

	const inputService = dependencies.inputService ?? createVscodeAnnotationInputService();
	const confirmed = await inputService.confirmPurgeDismissed(readyState.projection.dismissedAnnotationsInActiveSession);

	if (!confirmed) {
		return {
			status: 'cancelled',
			commandId: annotationCommandIds.purgeDismissedAnnotations,
			workspaceFolder: workspaceFolder.uri.fsPath,
		};
	}

	const result = await service.purgeDismissedAnnotations();
	return toMutationCommandResult(
		annotationCommandIds.purgeDismissedAnnotations,
		result,
		windowApi,
		workspaceFolder.uri.fsPath,
		'Purged dismissed annotations from the active review session.',
		'dismissedAnnotationsPurged',
		dependencies.contextKeys,
	);
}

export async function executeDeleteReviewSessionCommand(
	dependencies: AnnotationCommandDependencies,
): Promise<AnnotationCommandResult> {
	return executeSessionMaintenanceCommand(dependencies, 'delete');
}

export async function executeClearReviewSessionAnnotationsCommand(
	dependencies: AnnotationCommandDependencies,
): Promise<AnnotationCommandResult> {
	return executeSessionMaintenanceCommand(dependencies, 'clear');
}

export async function executeDismissAnnotationCommand(
	dependencies: AnnotationCommandDependencies,
	args?: AnnotationCommandArguments,
): Promise<AnnotationCommandResult> {
	return executeDirectLifecycleCommand(dependencies, annotationCommandIds.dismissAnnotation, 'dismiss', args);
}

export async function executeResolveAnnotationCommand(
	dependencies: AnnotationCommandDependencies,
	args?: AnnotationCommandArguments,
): Promise<AnnotationCommandResult> {
	return executeDirectLifecycleCommand(dependencies, annotationCommandIds.resolveAnnotation, 'resolve', args);
}

export async function executeReopenAnnotationCommand(
	dependencies: AnnotationCommandDependencies,
	args?: AnnotationCommandArguments,
): Promise<AnnotationCommandResult> {
	return executeDirectLifecycleCommand(dependencies, annotationCommandIds.reopenAnnotation, 'reopen', args);
}

export async function executeReanchorAnnotationCommand(
	dependencies: AnnotationCommandDependencies,
	args?: AnnotationCommandArguments,
): Promise<AnnotationCommandResult> {
	const windowApi = dependencies.window ?? vscode.window;
	const resolved = await resolveAnnotationCommandTarget(dependencies, annotationCommandIds.reanchorAnnotation, args);

	if ('commandId' in resolved) {
		return resolved;
	}

	if (!resolved.editor || !resolved.filePath) {
		return reportBlocked(
			annotationCommandIds.reanchorAnnotation,
			resolved.workspaceFolder.uri.fsPath,
			'noEditorSelection',
			'Select the new anchor range before reanchoring the annotation.',
			windowApi,
		);
	}

	if (resolved.editor.selection.isEmpty) {
		return reportBlocked(
			annotationCommandIds.reanchorAnnotation,
			resolved.workspaceFolder.uri.fsPath,
			'noEditorSelection',
			'Select the new anchor range before reanchoring the annotation.',
			windowApi,
		);
	}

	const anchor = createAnchorFromEditorSelection(resolved.editor);
	const validation = validateSelection(resolved.editor.selection, anchor);

	if (validation) {
		void windowApi.showErrorMessage(validation);
		return {
			status: 'blocked',
			commandId: annotationCommandIds.reanchorAnnotation,
			reason: 'invalidSelection',
			message: validation,
			workspaceFolder: resolved.workspaceFolder.uri.fsPath,
		};
	}

	const inputService = dependencies.inputService ?? createVscodeAnnotationInputService();
	const confirmed = await inputService.confirmReanchor();

	if (!confirmed) {
		return {
			status: 'cancelled',
			commandId: annotationCommandIds.reanchorAnnotation,
			workspaceFolder: resolved.workspaceFolder.uri.fsPath,
		};
	}

	const result = await resolved.service.reanchorAnnotation({
		annotationId: resolved.annotation.annotationId,
		filePath: resolved.filePath,
		anchor,
	});
	return toMutationCommandResult(
		annotationCommandIds.reanchorAnnotation,
		result,
		windowApi,
		resolved.workspaceFolder.uri.fsPath,
		'Reanchored the annotation to the current selection.',
		'annotationReanchored',
		dependencies.contextKeys,
	);
}

export async function executeGenerateDraftOutputCommand(
	dependencies: AnnotationCommandDependencies,
): Promise<AnnotationCommandResult> {
	const windowApi = dependencies.window ?? vscode.window;
	const workspaceApi = dependencies.workspace ?? vscode.workspace;
	const workspaceFolder = resolvePaletteWorkspaceFolder(windowApi.activeTextEditor);

	if (!workspaceFolder) {
		return blockWithoutWorkspace(windowApi, annotationCommandIds.generateDraftOutput);
	}

	const service = await dependencies.getWorkspaceService(workspaceFolder);
	const result = await service.generateDraftOutput();

	if (result.status === 'blocked') {
		return reportWorkspaceBlocked(
			annotationCommandIds.generateDraftOutput,
			result,
			windowApi,
			workspaceFolder.uri.fsPath,
			workspaceApi,
		);
	}

	if (!result.projection.activeSessionId) {
		return reportBlocked(
			annotationCommandIds.generateDraftOutput,
			workspaceFolder.uri.fsPath,
			'noActiveSession',
			'Select a review session before generating draft output.',
			windowApi,
		);
	}

	const format = workspaceApi
		.getConfiguration('aiToolkit')
		.get<DraftOutputFormat>('draftOutputFormat', 'markdown');
	const { content, languageId } = generateDraftContent(result.projection, format);

	const activeSession = result.projection.sessions.find((s) => s.isActive);
	const sessionSlug = activeSession?.sessionSlug ?? 'draft';
	const ext = languageId === 'markdown' ? 'md' : languageId;
	const uri = vscode.Uri.from({ scheme: 'untitled', path: `ai-toolkit-${sessionSlug}.${ext}` });

	try {
		const doc = await workspaceApi.openTextDocument(uri);
		const editor = await windowApi.showTextDocument(doc);
		await editor.edit((eb) => eb.insert(new vscode.Position(0, 0), content));
	} catch {
		const message = 'Unable to open the generated draft output document.';
		void windowApi.showErrorMessage(message);
		return {
			status: 'blocked',
			commandId: annotationCommandIds.generateDraftOutput,
			reason: 'documentOpenFailed',
			message,
			workspaceFolder: workspaceFolder.uri.fsPath,
		};
	}

	return {
		status: 'ready',
		commandId: annotationCommandIds.generateDraftOutput,
		workspaceFolder: workspaceFolder.uri.fsPath,
		operation: 'draftOutputGenerated',
	};
}

async function executeExistingAnnotationAction(
	dependencies: AnnotationCommandDependencies,
	workspaceFolder: vscode.WorkspaceFolder,
	editor: vscode.TextEditor,
	annotation: AnnotationProjectionEntry,
	options: { allowReanchor?: boolean } = {},
): Promise<AnnotationCommandResult> {
	const service = await dependencies.getWorkspaceService(workspaceFolder);
	const windowApi = dependencies.window ?? vscode.window;
	const inputService = dependencies.inputService ?? createVscodeAnnotationInputService();
	const availableActions = listAvailableExistingAnnotationActions(
		annotation,
		editor,
		options.allowReanchor ?? true,
	);
	const action = await inputService.pickExistingAnnotationAction(annotation, availableActions);

	if (!action) {
		return {
			status: 'cancelled',
			commandId: annotationCommandIds.addOrEditAnnotation,
			workspaceFolder: workspaceFolder.uri.fsPath,
		};
	}

	return executeAnnotationAction({
		dependencies,
		service,
		workspaceFolder,
		editor,
		annotation,
		commandId: annotationCommandIds.addOrEditAnnotation,
		action,
	});
}

function listAvailableExistingAnnotationActions(
	annotation: AnnotationProjectionEntry,
	editor: vscode.TextEditor | undefined,
	allowReanchor: boolean,
): ExistingAnnotationAction[] {
	const availableActions: ExistingAnnotationAction[] = ['edit'];

	if (annotation.status === 'active') {
		availableActions.push('resolve');
	}

	if (annotation.status === 'resolved') {
		availableActions.push('reopen');
	}

	availableActions.push('dismiss');

	if (allowReanchor && editor && canOfferReanchorAction(editor)) {
		availableActions.push('reanchor');
	}

	return availableActions;
}

export function createAnnotationCommentContextValue(
	annotation: AnnotationProjectionEntry,
	options: {
		editor?: vscode.TextEditor;
		allowReanchor?: boolean;
	} = {},
): string {
	const availableActions = listAvailableExistingAnnotationActions(
		annotation,
		options.editor,
		options.allowReanchor ?? false,
	);
	const tokens = [
		annotationCommentContextTokens.controller,
		`${annotationCommentContextTokens.statusPrefix}${annotation.status}`,
		...availableActions.map((action) => `${annotationCommentContextTokens.actionPrefix}${action}`),
	];

	return tokens.join(' ');
}

function canOfferReanchorAction(editor: vscode.TextEditor): boolean {
	if (editor.selection.isEmpty) {
		return false;
	}

	const anchor = createAnchorFromEditorSelection(editor);
	return validateSelection(editor.selection, anchor) === undefined;
}

async function executeAnnotationAction(
	params: {
		dependencies: AnnotationCommandDependencies;
		service: AnnotationWorkspaceServiceLike;
		workspaceFolder: vscode.WorkspaceFolder;
		editor?: vscode.TextEditor;
		annotation: AnnotationProjectionEntry;
		commandId: AnnotationCommandId;
		action: ExistingAnnotationAction;
	},
): Promise<AnnotationCommandResult> {
	const { dependencies, service, workspaceFolder, editor, annotation, commandId, action } = params;
	const windowApi = dependencies.window ?? vscode.window;
	const inputService = dependencies.inputService ?? createVscodeAnnotationInputService();

	if (action === 'dismiss') {
		const result = await service.dismissAnnotation(annotation.annotationId);
		return toMutationCommandResult(
			commandId,
			result,
			windowApi,
			workspaceFolder.uri.fsPath,
			'Annotation dismissed.',
			'annotationDismissed',
			dependencies.contextKeys,
		);
	}

	if (action === 'reanchor') {
		if (!editor || editor.selection.isEmpty) {
			return reportBlocked(
				commandId,
				workspaceFolder.uri.fsPath,
				'noEditorSelection',
				'Select the new anchor range before reanchoring the annotation.',
				windowApi,
			);
		}

		const anchor = createAnchorFromEditorSelection(editor);
		const validation = validateSelection(editor.selection, anchor);

		if (validation) {
			void windowApi.showErrorMessage(validation);
			return {
				status: 'blocked',
				commandId,
				reason: 'invalidSelection',
				message: validation,
				workspaceFolder: workspaceFolder.uri.fsPath,
			};
		}

		const confirmed = await inputService.confirmReanchor();

		if (!confirmed) {
			return {
				status: 'cancelled',
				commandId,
				workspaceFolder: workspaceFolder.uri.fsPath,
			};
		}

		const filePath = toWorkspaceRelativeFilePath(workspaceFolder, editor.document.uri);

		if (!filePath) {
			return blockWithoutWorkspace(windowApi, commandId);
		}

		const result = await service.reanchorAnnotation({
			annotationId: annotation.annotationId,
			filePath,
			anchor,
		});
		return toMutationCommandResult(
			commandId,
			result,
			windowApi,
			workspaceFolder.uri.fsPath,
			'Reanchored the annotation to the current selection.',
			'annotationReanchored',
			dependencies.contextKeys,
		);
	}

	if (action === 'resolve') {
		const result = await service.resolveAnnotation(annotation.annotationId);
		return toMutationCommandResult(
			commandId,
			result,
			windowApi,
			workspaceFolder.uri.fsPath,
			'Annotation resolved.',
			'annotationResolved',
			dependencies.contextKeys,
		);
	}

	if (action === 'reopen') {
		const result = await service.reopenAnnotation(annotation.annotationId);
		return toMutationCommandResult(
			commandId,
			result,
			windowApi,
			workspaceFolder.uri.fsPath,
			'Annotation reopened.',
			'annotationReopened',
			dependencies.contextKeys,
		);
	}

	const body = await inputService.promptForAnnotationBody(annotation.body);

	if (!body) {
		return {
			status: 'cancelled',
			commandId,
			workspaceFolder: workspaceFolder.uri.fsPath,
		};
	}

	const result = await service.updateAnnotation({ annotationId: annotation.annotationId, body });
	return toMutationCommandResult(
		commandId,
		result,
		windowApi,
		workspaceFolder.uri.fsPath,
		'Annotation updated.',
		'annotationUpdated',
		dependencies.contextKeys,
	);
}

function getInvalidLifecycleMessage(action: Extract<ExistingAnnotationAction, 'resolve' | 'reopen'>): string {
	return action === 'resolve'
		? 'Only active annotations can be resolved.'
		: 'Only resolved annotations can be reopened.';
}

async function executeDirectLifecycleCommand(
	dependencies: AnnotationCommandDependencies,
	commandId: Extract<AnnotationCommandId, 'ai-toolkit.dismissAnnotation' | 'ai-toolkit.resolveAnnotation' | 'ai-toolkit.reopenAnnotation'>,
	action: Extract<ExistingAnnotationAction, 'dismiss' | 'resolve' | 'reopen'>,
	args?: AnnotationCommandArguments,
): Promise<AnnotationCommandResult> {
	const windowApi = dependencies.window ?? vscode.window;
	const resolved = await resolveAnnotationCommandTarget(dependencies, commandId, args);

	if ('commandId' in resolved) {
		return resolved;
	}

	const availableActions = listAvailableExistingAnnotationActions(resolved.annotation, resolved.editor, true);
	if (action !== 'dismiss' && !availableActions.includes(action)) {
		const message = getInvalidLifecycleMessage(action);
		void windowApi.showWarningMessage(message);
		return {
			status: 'blocked',
			commandId,
			reason: 'invalidAnnotationStatus',
			message,
			workspaceFolder: resolved.workspaceFolder.uri.fsPath,
		};
	}

	return executeAnnotationAction({
		dependencies,
		service: resolved.service,
		workspaceFolder: resolved.workspaceFolder,
		editor: resolved.editor,
		annotation: resolved.annotation,
		commandId,
		action,
	});
}

async function resolveAnnotationCommandTarget(
	dependencies: AnnotationCommandDependencies,
	commandId: AnnotationCommandId,
	args?: AnnotationCommandArguments,
): Promise<
	| {
		resolved: true;
		service: AnnotationWorkspaceServiceLike;
		workspaceFolder: vscode.WorkspaceFolder;
		annotation: AnnotationProjectionEntry;
		editor?: vscode.TextEditor;
		filePath?: string;
	}
	| AnnotationCommandResult
> {
	const windowApi = dependencies.window ?? vscode.window;
	const workspaceApi = dependencies.workspace ?? vscode.workspace;
	const editor = windowApi.activeTextEditor;
	const thread = extractCommentThread(args);
	const workspaceFolder = resolveEditorWorkspaceFolder(editor) ?? resolveThreadWorkspaceFolder(thread);

	if (!workspaceFolder) {
		return blockWithoutWorkspace(windowApi, commandId);
	}

	const service = await dependencies.getWorkspaceService(workspaceFolder);
	const relativePath = editor
		? toWorkspaceRelativeFilePath(workspaceFolder, editor.document.uri)
		: undefined;

	const readyState = await ensureReadyState(service);

	if (isWorkspaceBlocked(readyState)) {
		return reportWorkspaceBlocked(commandId, readyState, windowApi, workspaceFolder.uri.fsPath, workspaceApi);
	}

	const annotationId = resolveCommandArgumentAnnotationId(args, dependencies.commentProjection);
	let annotation = annotationId
		? readyState.projection.annotations.find((entry) => entry.annotationId === annotationId)
		: undefined;

	if (annotation?.status === 'dismissed') {
		annotation = undefined;
	}

	if (!annotation && editor && relativePath) {
		const targetResult = resolveAnnotationTarget(readyState.projection.annotations, relativePath, editor.selection);

		if (targetResult.kind === 'conflict') {
			return reportBlocked(
				commandId,
				workspaceFolder.uri.fsPath,
				'invalidSelection',
				'The selection overlaps multiple annotations. Narrow the selection to a single annotation.',
				windowApi,
			);
		}

		if (targetResult.kind === 'found' && targetResult.annotation.status !== 'dismissed') {
			annotation = targetResult.annotation;
		}
	}

	if (!annotation) {
		return reportBlocked(
			commandId,
			workspaceFolder.uri.fsPath,
			'annotationNotFound',
			'The current editor selection does not resolve to a stored annotation.',
			windowApi,
		);
	}

	return {
		resolved: true,
		service,
		workspaceFolder,
		editor,
		annotation,
		filePath: relativePath,
	};
}

function resolveCommandArgumentAnnotationId(
	args: AnnotationCommandArguments | undefined,
	commentProjection?: Pick<AnnotationCommentProjectionService, 'getAnnotationId'>,
): string | undefined {
	if (isAnnotationCommandArgument(args) && typeof args.annotationId === 'string') {
		return args.annotationId;
	}

	const thread = extractCommentThread(args);
	return thread ? commentProjection?.getAnnotationId(thread) : undefined;
}

function extractCommentThread(args: AnnotationCommandArguments | undefined): vscode.CommentThread | undefined {
	if (isCommentThread(args)) {
		return args;
	}

	if (isCommentWithThread(args)) {
		return args.thread;
	}

	return undefined;
}

function isAnnotationCommandArgument(
	args: AnnotationCommandArguments | undefined,
): args is { annotationId?: string } {
	return Boolean(args) && typeof args === 'object' && 'annotationId' in args;
}

function isCommentThread(args: AnnotationCommandArguments | undefined): args is vscode.CommentThread {
	return Boolean(args) && typeof args === 'object' && 'uri' in args && 'range' in args && 'comments' in args;
}

function isCommentWithThread(
	args: AnnotationCommandArguments | undefined,
): args is vscode.Comment & { thread: vscode.CommentThread } {
	if (!args || typeof args !== 'object' || !('thread' in args)) {
		return false;
	}

	const candidate = args as { thread?: unknown };
	return isCommentThread(candidate.thread as AnnotationCommandArguments | undefined);
}

function resolveThreadWorkspaceFolder(thread: vscode.CommentThread | undefined): vscode.WorkspaceFolder | undefined {
	return thread ? vscode.workspace.getWorkspaceFolder(thread.uri) : undefined;
}

async function ensureReadyState(
	service: AnnotationWorkspaceServiceLike,
): Promise<
	| AnnotationWorkspaceReadyState
	| {
		status: 'blocked';
		reason: AnnotationWorkspaceBlockedReason;
		message: string;
		storePath: string;
		error?: Error;
		latestState?: AnnotationWorkspaceReadyState | { status: 'invalid'; storePath: string; error: Error };
	}
> {
	const state = service.getState() ?? (await service.initialize());

	if (state.status === 'invalid') {
		return {
			status: 'blocked',
			reason: 'invalidStore',
			message: 'The annotation store is invalid. Fix the store file before running annotation commands.',
			storePath: state.storePath,
			error: state.error,
			latestState: state,
		};
	}

	return state;
}

function isWorkspaceBlocked(
	state:
		| AnnotationWorkspaceReadyState
		| {
			status: 'blocked';
			reason: AnnotationWorkspaceBlockedReason;
			message: string;
			storePath: string;
			error?: Error;
			latestState?: AnnotationWorkspaceReadyState | { status: 'invalid'; storePath: string; error: Error };
		},
): state is {
	status: 'blocked';
	reason: AnnotationWorkspaceBlockedReason;
	message: string;
	storePath: string;
	error?: Error;
	latestState?: AnnotationWorkspaceReadyState | { status: 'invalid'; storePath: string; error: Error };
} {
	return state.status === 'blocked';
}

function resolveEditorWorkspaceFolder(
	editor: vscode.TextEditor | undefined,
): vscode.WorkspaceFolder | undefined {
	return findWorkspaceFolderForEditor(editor);
}

function resolvePaletteWorkspaceFolder(
	editor: vscode.TextEditor | undefined,
): vscode.WorkspaceFolder | undefined {
	return findWorkspaceFolderForEditor(editor) ?? findWorkspaceFolderForPaletteCommand();
}

function validateSelection(selection: vscode.Selection, anchor: AnnotationAnchor): string | undefined {
	if (countSelectedLines(selection) > maxAnnotationSelectionLines) {
		return `Select ${maxAnnotationSelectionLines} lines or fewer before creating or reanchoring an annotation.`;
	}

	try {
		validateNewAnnotationSelectedLines(anchor.selectedLines);
		return undefined;
	} catch {
		return 'Select at least one character before creating or reanchoring an annotation.';
	}
}

function countSelectedLines(selection: vscode.Selection): number {
	if (selection.isEmpty) {
		return 0;
	}

	const selectionStart = selection.start;
	const selectionEnd = selection.end;
	let selectedLineCount = selectionEnd.line - selectionStart.line + 1;

	if (selectionEnd.character === 0 && selectionEnd.line > selectionStart.line) {
		selectedLineCount -= 1;
	}

	return selectedLineCount;
}

function blockWithoutWorkspace(
	windowApi: Pick<typeof vscode.window, 'showWarningMessage'>,
	commandId: AnnotationCommandId,
): AnnotationCommandResult {
	const message = 'AI Toolkit annotations require a saved file inside a workspace folder.';
	void windowApi.showWarningMessage(message);
	return {
		status: 'blocked',
		commandId,
		reason: 'noWorkspaceFolder',
		message,
	};
}

function reportWorkspaceBlocked(
	commandId: AnnotationCommandId,
	blocked: { reason: AnnotationWorkspaceBlockedReason; message: string; storePath?: string },
	windowApi: Pick<typeof vscode.window, 'showErrorMessage' | 'showTextDocument'>,
	workspaceFolder: string,
	workspaceApi: Pick<typeof vscode.workspace, 'openTextDocument'> = vscode.workspace,
): AnnotationCommandResult {
	if (blocked.reason === 'invalidStore' && blocked.storePath) {
		void openBlockedStore(blocked.message, blocked.storePath, windowApi, workspaceApi);
	} else {
		void windowApi.showErrorMessage(blocked.message);
	}

	return {
		status: 'blocked',
		commandId,
		reason: blocked.reason,
		message: blocked.message,
		workspaceFolder,
	};
}

async function openBlockedStore(
	message: string,
	storePath: string,
	windowApi: Pick<typeof vscode.window, 'showErrorMessage' | 'showTextDocument'>,
	workspaceApi: Pick<typeof vscode.workspace, 'openTextDocument'>,
): Promise<void> {
	const action = await windowApi.showErrorMessage(message, 'Open Store');

	if (action !== 'Open Store') {
		return;
	}

	try {
		const doc = await workspaceApi.openTextDocument(vscode.Uri.file(storePath));
		await windowApi.showTextDocument(doc);
	} catch {
		void windowApi.showErrorMessage('Unable to open the annotation store document.');
	}
}

function reportBlocked(
	commandId: AnnotationCommandId,
	workspaceFolder: string,
	reason: AnnotationCommandBlockedReason,
	message: string,
	windowApi: Pick<typeof vscode.window, 'showWarningMessage'>,
): AnnotationCommandResult {
	void windowApi.showWarningMessage(message);
	return {
		status: 'blocked',
		commandId,
		reason,
		message,
		workspaceFolder,
	};
}

async function toMutationCommandResult(
	commandId: AnnotationCommandId,
	result: AnnotationWorkspaceMutationResult,
	windowApi: Pick<typeof vscode.window, 'showErrorMessage' | 'showInformationMessage'>,
	workspaceFolder: string,
	successMessage: string,
	operation: Extract<AnnotationCommandResult, { status: 'ready' }>['operation'],
	contextKeys?: AnnotationContextKeyController,
): Promise<AnnotationCommandResult> {
	if (result.status === 'blocked') {
		void windowApi.showErrorMessage(result.message);
		return {
			status: 'blocked',
			commandId,
			reason: result.reason,
			message: result.message,
			workspaceFolder,
		};
	}

	void windowApi.showInformationMessage(successMessage);
	await refreshContextKeysBestEffort(contextKeys, commandId, workspaceFolder);
	return {
		status: 'ready',
		commandId,
		workspaceFolder,
		operation,
		annotationId: result.annotation?.annotationId,
		sessionId: result.sessionId,
		purgedCount: result.purgedCount,
	};
}

async function refreshContextKeysBestEffort(
	contextKeys: AnnotationContextKeyController | undefined,
	commandId: AnnotationCommandId,
	workspaceFolder: string,
): Promise<void> {
	if (!contextKeys) {
		return;
	}

	try {
		await contextKeys.refresh();
	} catch (error) {
		logger.warn('Context-key refresh failed after a successful annotation command.', {
			commandId,
			workspaceFolder,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

async function executeSessionMaintenanceCommand(
	dependencies: AnnotationCommandDependencies,
	operation: SessionMaintenanceOperation,
): Promise<AnnotationCommandResult> {
	const commandId = operation === 'delete'
		? annotationCommandIds.deleteReviewSession
		: annotationCommandIds.clearReviewSessionAnnotations;
	const windowApi = dependencies.window ?? vscode.window;
	const workspaceApi = dependencies.workspace ?? vscode.workspace;
	const workspaceFolder = resolvePaletteWorkspaceFolder(windowApi.activeTextEditor);

	if (!workspaceFolder) {
		return blockWithoutWorkspace(windowApi, commandId);
	}

	const service = await dependencies.getWorkspaceService(workspaceFolder);
	const readyState = await ensureReadyState(service);

	if (isWorkspaceBlocked(readyState)) {
		return reportWorkspaceBlocked(commandId, readyState, windowApi, workspaceFolder.uri.fsPath, workspaceApi);
	}

	if (readyState.projection.sessions.length === 0) {
		const message = operation === 'delete'
			? 'There are no review sessions to delete.'
			: 'There are no review sessions to clear.';
		void windowApi.showInformationMessage(message);
		return {
			status: 'blocked',
			commandId,
			reason: 'noReviewSessions',
			message,
			workspaceFolder: workspaceFolder.uri.fsPath,
		};
	}

	const presenter = dependencies.sessionMaintenancePresenter ?? createVscodeSessionMaintenanceQuickPickPresenter();
	const selected = await presenter.pickSession(
		operation,
		createSessionMaintenanceQuickPickItems(readyState.projection.sessions),
	);

	if (!selected) {
		return {
			status: 'cancelled',
			commandId,
			workspaceFolder: workspaceFolder.uri.fsPath,
		};
	}

	const inputService = dependencies.inputService ?? createVscodeAnnotationInputService();
	const confirmed = operation === 'delete'
		? await (inputService.confirmDeleteSession
			? inputService.confirmDeleteSession(selected.label, selected.annotationCount, selected.isActive)
			: confirmDeleteSessionWithWindow(windowApi, selected.label, selected.annotationCount, selected.isActive))
		: await (inputService.confirmClearSessionAnnotations
			? inputService.confirmClearSessionAnnotations(selected.label, selected.annotationCount)
			: confirmClearSessionAnnotationsWithWindow(windowApi, selected.label, selected.annotationCount));

	if (!confirmed) {
		return {
			status: 'cancelled',
			commandId,
			workspaceFolder: workspaceFolder.uri.fsPath,
		};
	}

	const result = operation === 'delete'
		? await service.deleteSession(selected.sessionId)
		: await service.clearSessionAnnotations(selected.sessionId);
	const successMessage = operation === 'delete'
		? createDeleteSessionSuccessMessage(selected.label, selected.isActive, result)
		: `Cleared ${selected.annotationCount} annotation${selected.annotationCount === 1 ? '' : 's'} from review session "${selected.label}".`;

	return toMutationCommandResult(
		commandId,
		result,
		windowApi,
		workspaceFolder.uri.fsPath,
		successMessage,
		operation === 'delete' ? 'reviewSessionDeleted' : 'reviewSessionAnnotationsCleared',
		dependencies.contextKeys,
	);
}

async function confirmDeleteSessionWithWindow(
	windowApi: Pick<typeof vscode.window, 'showWarningMessage'>,
	sessionName: string,
	annotationCount: number,
	isActiveSession: boolean,
): Promise<boolean> {
	const choice = await windowApi.showWarningMessage(
		`${isActiveSession ? 'This is the active review session. ' : ''}Delete review session "${sessionName}" and remove its ${annotationCount} annotation${annotationCount === 1 ? '' : 's'}?`,
		{ modal: true },
		'Delete Session',
	);

	return choice === 'Delete Session';
}

async function confirmClearSessionAnnotationsWithWindow(
	windowApi: Pick<typeof vscode.window, 'showWarningMessage'>,
	sessionName: string,
	annotationCount: number,
): Promise<boolean> {
	const choice = await windowApi.showWarningMessage(
		`Clear ${annotationCount} annotation${annotationCount === 1 ? '' : 's'} from review session "${sessionName}"?`,
		{ modal: true },
		'Clear Annotations',
	);

	return choice === 'Clear Annotations';
}

function createDeleteSessionSuccessMessage(
	deletedSessionName: string,
	wasActiveSession: boolean,
	result: AnnotationWorkspaceMutationResult,
): string {
	if (result.status === 'blocked' || !wasActiveSession || !result.sessionId) {
		return `Deleted review session "${deletedSessionName}".`;
	}

	const activeSession = result.projection.sessions.find((session) => session.sessionId === result.sessionId);
	if (!activeSession) {
		return `Deleted review session "${deletedSessionName}".`;
	}

	return `Deleted review session "${deletedSessionName}". Active review session is now "${activeSession.name}".`;
}