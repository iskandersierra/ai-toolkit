import * as vscode from 'vscode';
import {
	annotationSelectedTextMaxLength,
	type AnnotationAnchor,
} from '../domain/annotationModels';
import { validateNewAnnotationSelectedText } from '../domain/annotationValidation';
import type {
	AnnotationWorkspaceBlockedReason,
	AnnotationWorkspaceMutationResult,
	AnnotationWorkspaceReadyState,
	AnnotationWorkspaceServiceLike,
} from '../application/annotationWorkspaceService';
import { SessionSelectionService } from '../application/sessionSelectionService';
import type { AnnotationProjectionEntry } from '../application/projectionModel';
import type { AnnotationContextKeyController } from '../bootstrap/annotationContextKeys';
import { createVscodeAnnotationInputService, type AnnotationInputService } from './annotationInput';
import {
	createAnchorFromEditorSelection,
	findAnnotationForEditorSelection,
	toWorkspaceRelativeFilePath,
} from './annotationTargeting';
import {
	findWorkspaceFolderForEditor,
	findWorkspaceFolderForPaletteCommand,
} from '../util/workspaceFolders';
import { generateDraftContent } from '../application/draftOutputService';
import type { DraftOutputFormat } from '../domain/draftShapes';

export const annotationCommandIds = {
	addOrEditAnnotation: 'ai-toolkit.addOrEditAnnotation',
	selectReviewSession: 'ai-toolkit.selectReviewSession',
	generateDraftOutput: 'ai-toolkit.generateDraftOutput',
	purgeDismissedAnnotations: 'ai-toolkit.purgeDismissedAnnotations',
	reanchorAnnotation: 'ai-toolkit.reanchorAnnotation',
	dismissAnnotation: 'ai-toolkit.dismissAnnotation',
} as const;

export type AnnotationCommandId = typeof annotationCommandIds[keyof typeof annotationCommandIds];

export type AnnotationCommandBlockedReason =
	| 'noWorkspaceFolder'
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
			| 'annotationReanchored'
			| 'reviewSessionSelected'
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
	sessionSelectionService: SessionSelectionService;
	getWorkspaceService(workspaceFolder: vscode.WorkspaceFolder): Promise<AnnotationWorkspaceServiceLike>;
	contextKeys?: AnnotationContextKeyController;
}

type AnnotationCommandArguments = {
	annotationId?: string;
};

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
		commands.registerCommand(annotationCommandIds.reanchorAnnotation, (args?: AnnotationCommandArguments) =>
			executeReanchorAnnotationCommand(dependencies, args),
		),
		commands.registerCommand(annotationCommandIds.dismissAnnotation, (args?: AnnotationCommandArguments) =>
			executeDismissAnnotationCommand(dependencies, args),
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

	const target = args?.annotationId
		? readyState.projection.annotations.find((annotation) => annotation.annotationId === args.annotationId)
		: findAnnotationForEditorSelection(readyState.projection.annotations, relativePath, editor.selection);

	if (target) {
		return executeExistingAnnotationAction(dependencies, workspaceFolder, editor, target);
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

	const anchor = createAnchorFromEditorSelection(editor);
	const validation = validateSelection(anchor);

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
	await dependencies.contextKeys?.refresh();
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

export async function executeDismissAnnotationCommand(
	dependencies: AnnotationCommandDependencies,
	args?: AnnotationCommandArguments,
): Promise<AnnotationCommandResult> {
	const windowApi = dependencies.window ?? vscode.window;
	const resolved = await resolveAnnotationCommandTarget(dependencies, annotationCommandIds.dismissAnnotation, args);

	if ('commandId' in resolved) {
		return resolved;
	}

	const result = await resolved.service.dismissAnnotation(resolved.annotation.annotationId);
	return toMutationCommandResult(
		annotationCommandIds.dismissAnnotation,
		result,
		windowApi,
		resolved.workspaceFolder.uri.fsPath,
		'Annotation dismissed.',
		'annotationDismissed',
		dependencies.contextKeys,
	);
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

	if (resolved.editor.selection.isEmpty) {
		return reportBlocked(
			annotationCommandIds.reanchorAnnotation,
			resolved.workspaceFolder.uri.fsPath,
			'noEditorSelection',
			'Select the new anchor range before reanchoring the annotation.',
			windowApi,
		);
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

	const anchor = createAnchorFromEditorSelection(resolved.editor);
	const validation = validateSelection(anchor);

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

	try {
		const doc = await workspaceApi.openTextDocument({ content, language: languageId });
		await windowApi.showTextDocument(doc);
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
): Promise<AnnotationCommandResult> {
	const windowApi = dependencies.window ?? vscode.window;
	const inputService = dependencies.inputService ?? createVscodeAnnotationInputService();
	const service = await dependencies.getWorkspaceService(workspaceFolder);
	const action = await inputService.pickExistingAnnotationAction(annotation);

	if (!action) {
		return {
			status: 'cancelled',
			commandId: annotationCommandIds.addOrEditAnnotation,
			workspaceFolder: workspaceFolder.uri.fsPath,
		};
	}

	if (action === 'dismiss') {
		const result = await service.dismissAnnotation(annotation.annotationId);
		return toMutationCommandResult(
			annotationCommandIds.addOrEditAnnotation,
			result,
			windowApi,
			workspaceFolder.uri.fsPath,
			'Annotation dismissed.',
			'annotationDismissed',
			dependencies.contextKeys,
		);
	}

	if (action === 'reanchor') {
		if (editor.selection.isEmpty) {
			return reportBlocked(
				annotationCommandIds.addOrEditAnnotation,
				workspaceFolder.uri.fsPath,
				'noEditorSelection',
				'Select the new anchor range before reanchoring the annotation.',
				windowApi,
			);
		}

		const confirmed = await inputService.confirmReanchor();

		if (!confirmed) {
			return {
				status: 'cancelled',
				commandId: annotationCommandIds.addOrEditAnnotation,
				workspaceFolder: workspaceFolder.uri.fsPath,
			};
		}

		const filePath = toWorkspaceRelativeFilePath(workspaceFolder, editor.document.uri);

		if (!filePath) {
			return blockWithoutWorkspace(windowApi, annotationCommandIds.addOrEditAnnotation);
		}

		const anchor = createAnchorFromEditorSelection(editor);
		const validation = validateSelection(anchor);

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

		const result = await service.reanchorAnnotation({
			annotationId: annotation.annotationId,
			filePath,
			anchor,
		});
		return toMutationCommandResult(
			annotationCommandIds.addOrEditAnnotation,
			result,
			windowApi,
			workspaceFolder.uri.fsPath,
			'Reanchored the annotation to the current selection.',
			'annotationReanchored',
			dependencies.contextKeys,
		);
	}

	const body = await inputService.promptForAnnotationBody(annotation.body);

	if (!body) {
		return {
			status: 'cancelled',
			commandId: annotationCommandIds.addOrEditAnnotation,
			workspaceFolder: workspaceFolder.uri.fsPath,
		};
	}

	const result = await service.updateAnnotation({ annotationId: annotation.annotationId, body });
	return toMutationCommandResult(
		annotationCommandIds.addOrEditAnnotation,
		result,
		windowApi,
		workspaceFolder.uri.fsPath,
		'Annotation updated.',
		'annotationUpdated',
		dependencies.contextKeys,
	);
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
		editor: vscode.TextEditor;
		annotation: AnnotationProjectionEntry;
		filePath: string;
	}
	| AnnotationCommandResult
> {
	const windowApi = dependencies.window ?? vscode.window;
	const workspaceApi = dependencies.workspace ?? vscode.workspace;
	const editor = windowApi.activeTextEditor;
	const workspaceFolder = resolveEditorWorkspaceFolder(editor);

	if (!workspaceFolder || !editor) {
		return blockWithoutWorkspace(windowApi, commandId);
	}

	const service = await dependencies.getWorkspaceService(workspaceFolder);
	const relativePath = toWorkspaceRelativeFilePath(workspaceFolder, editor.document.uri);

	if (!relativePath) {
		return blockWithoutWorkspace(windowApi, commandId);
	}

	const readyState = await ensureReadyState(service);

	if (isWorkspaceBlocked(readyState)) {
		return reportWorkspaceBlocked(commandId, readyState, windowApi, workspaceFolder.uri.fsPath, workspaceApi);
	}

	const annotation = args?.annotationId
		? readyState.projection.annotations.find((entry) => entry.annotationId === args.annotationId)
		: findAnnotationForEditorSelection(readyState.projection.annotations, relativePath, editor.selection);

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

function validateSelection(anchor: AnnotationAnchor): string | undefined {
	try {
		validateNewAnnotationSelectedText(anchor.selectedText);
		return undefined;
	} catch {
		return `Selected text must be at most ${annotationSelectedTextMaxLength} characters.`;
	}
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
	await contextKeys?.refresh();
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