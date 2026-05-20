import * as vscode from 'vscode';
import {
	AnnotationWorkspaceService,
	type AnnotationWorkspaceFolder,
	type AnnotationWorkspaceWatcherFactory,
} from '../application/annotationWorkspaceService';
import { SessionSelectionService } from '../application/sessionSelectionService';
import { registerAnnotationContextKeys } from './annotationContextKeys';
import { annotationCommandIds, registerAnnotationCommands, type AnnotationCommandResult } from '../presentation/annotationCommands';
import { createVscodeAnnotationInputService } from '../presentation/annotationInput';
import { createVscodeSessionQuickPickPresenter } from '../presentation/sessionQuickPick';
import { AnnotationStorageController } from '../infrastructure/annotationStorageController';
import { AnnotationStoreWatcher } from '../infrastructure/annotationStoreWatcher';
import { AnnotationCommentProjectionService } from '../presentation/annotationCommentProjectionService';
import { AnnotationCodeLensProvider } from '../presentation/annotationCodeLensProvider';

export { annotationCommandIds, type AnnotationCommandResult };

export function registerAnnotationFeature(context: vscode.ExtensionContext): void {
	const serviceRegistry = new AnnotationWorkspaceServiceRegistry();
	const commentProjection = new AnnotationCommentProjectionService();
	const codeLensProvider = new AnnotationCodeLensProvider();
	const contextKeys = registerAnnotationContextKeys(context, {
		getWorkspaceService: async (workspaceFolder) => serviceRegistry.getWorkspaceService(workspaceFolder, contextKeys, commentProjection, codeLensProvider),
	});
	const sessionSelectionService = new SessionSelectionService(createVscodeSessionQuickPickPresenter());

	registerAnnotationCommands(context, {
		getWorkspaceService: async (workspaceFolder) => serviceRegistry.getWorkspaceService(workspaceFolder, contextKeys, commentProjection, codeLensProvider),
		sessionSelectionService,
		inputService: createVscodeAnnotationInputService(),
		contextKeys,
	});

	context.subscriptions.push(
		contextKeys,
		serviceRegistry,
		commentProjection,
		codeLensProvider,
		vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLensProvider),
	);
}

class AnnotationWorkspaceServiceRegistry implements vscode.Disposable {
	private readonly services = new Map<string, AnnotationWorkspaceService>();
	private readonly subscriptions: vscode.Disposable[] = [];

	public async getWorkspaceService(
		workspaceFolder: vscode.WorkspaceFolder,
		contextKeys?: { refresh(): Promise<void> },
		commentProjection?: AnnotationCommentProjectionService,
		codeLensProvider?: AnnotationCodeLensProvider,
	): Promise<AnnotationWorkspaceService> {
		const key = workspaceFolder.uri.toString();
		const existing = this.services.get(key);

		if (existing) {
			return existing;
		}

		const service = new AnnotationWorkspaceService(workspaceFolder as AnnotationWorkspaceFolder, {
			storage: new AnnotationStorageController(workspaceFolder.uri.fsPath),
			watcherFactory: createWorkspaceWatcher,
		});

		if (contextKeys) {
			this.subscriptions.push(
				service.onDidChangeState(() => {
					void contextKeys.refresh();
				}),
			);
		}

		if (commentProjection || codeLensProvider) {
			this.subscriptions.push(
				service.onDidChangeState(() => {
					const state = service.getState();

					if (state?.status === 'ready') {
						commentProjection?.refresh(state.projection);
						codeLensProvider?.refresh(state.projection);
					}
				}),
			);
		}

		this.services.set(key, service);
		await service.initialize();
		return service;
	}

	public dispose(): void {
		for (const service of this.services.values()) {
			service.dispose();
		}

		for (const subscription of this.subscriptions) {
			subscription.dispose();
		}

		this.services.clear();
		this.subscriptions.length = 0;
	}
}

const createWorkspaceWatcher: AnnotationWorkspaceWatcherFactory = (workspaceFolder, onChange) =>
	new AnnotationStoreWatcher(workspaceFolder as vscode.WorkspaceFolder, () => onChange());