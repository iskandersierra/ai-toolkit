import * as assert from 'assert';
import * as vscode from 'vscode';
import { beforeEach, vi } from 'vitest';

type StateChangeListener = () => void;

const registerAnnotationContextKeysMock = vi.fn();
const registerAnnotationCommandsMock = vi.fn();
const createVscodeAnnotationInputServiceMock = vi.fn();
const createVscodeSessionQuickPickPresenterMock = vi.fn();
const registerCodeLensProviderMock = vi.fn();
const annotationWorkspaceServiceInstances: FakeAnnotationWorkspaceService[] = [];
const annotationStorageControllerArgs: string[] = [];
const createWorkspaceWatcherArgs: Array<{ workspaceFolder: vscode.WorkspaceFolder; onChange: () => void }> = [];

vi.mock('../../annotations/bootstrap/annotationContextKeys', () => ({
	registerAnnotationContextKeys: registerAnnotationContextKeysMock,
}));

vi.mock('../../annotations/presentation/annotationCommands', () => ({
	annotationCommandIds: {
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
	},
	registerAnnotationCommands: registerAnnotationCommandsMock,
}));

vi.mock('../../annotations/presentation/annotationInput', () => ({
	createVscodeAnnotationInputService: createVscodeAnnotationInputServiceMock,
}));

vi.mock('../../annotations/presentation/sessionQuickPick', () => ({
	createVscodeSessionQuickPickPresenter: createVscodeSessionQuickPickPresenterMock,
}));

vi.mock('../../annotations/application/sessionSelectionService', () => ({
	SessionSelectionService: class {
		public constructor(public readonly presenter: unknown) {}
	},
}));

vi.mock('../../annotations/application/annotationWorkspaceService', () => ({
	AnnotationWorkspaceService: FakeAnnotationWorkspaceService,
}));

vi.mock('../../annotations/infrastructure/annotationStorageController', () => ({
	AnnotationStorageController: class {
		public constructor(workspaceFolderPath: string) {
			annotationStorageControllerArgs.push(workspaceFolderPath);
		}
	},
}));

vi.mock('../../annotations/infrastructure/annotationStoreWatcher', () => ({
	AnnotationStoreWatcher: class {
		public constructor(workspaceFolder: vscode.WorkspaceFolder, onChange: () => void) {
			createWorkspaceWatcherArgs.push({ workspaceFolder, onChange });
		}
		public dispose(): void {}
	},
}));

vi.mock('../../annotations/presentation/annotationCommentProjectionService', () => ({
	AnnotationCommentProjectionService: class {
		public readonly refresh = vi.fn();
		public readonly dispose = vi.fn();
	},
}));

vi.mock('../../annotations/presentation/annotationCodeLensProvider', () => ({
	AnnotationCodeLensProvider: class {
		public readonly refresh = vi.fn();
		public readonly dispose = vi.fn();
	},
}));

suite('Register Annotation Feature', () => {
	beforeEach(() => {
		annotationWorkspaceServiceInstances.length = 0;
		annotationStorageControllerArgs.length = 0;
		createWorkspaceWatcherArgs.length = 0;
		registerAnnotationContextKeysMock.mockReset();
		registerAnnotationCommandsMock.mockReset();
		createVscodeAnnotationInputServiceMock.mockReset();
		createVscodeSessionQuickPickPresenterMock.mockReset();
		registerCodeLensProviderMock.mockReset();

		(vscode.languages as { registerCodeLensProvider: typeof vscode.languages.registerCodeLensProvider }).registerCodeLensProvider =
			registerCodeLensProviderMock as typeof vscode.languages.registerCodeLensProvider;
	});

	// Scenario: Given the feature is registered, When workspace services emit invalid then ready state changes, Then registration, reuse, refresh, and disposal all flow through the bootstrap registry.
	test('registers the feature and reuses workspace services across callbacks', async () => {
		const contextKeys = {
			refresh: vi.fn(async () => undefined),
			dispose: vi.fn(),
		};
		registerAnnotationContextKeysMock.mockReturnValue(contextKeys);
		createVscodeAnnotationInputServiceMock.mockReturnValue({ source: 'input-service' });
		createVscodeSessionQuickPickPresenterMock.mockReturnValue({ source: 'session-quick-pick' });

		const registerCodeLensProviderDisposable = { dispose: vi.fn() };
		registerCodeLensProviderMock.mockReturnValue(registerCodeLensProviderDisposable);

		const context = createExtensionContext();
		const workspaceFolder = createWorkspaceFolder('e:/source/ai-toolkit');

		const { registerAnnotationFeature } = await import('../../annotations/bootstrap/registerAnnotationFeature');

		registerAnnotationFeature(context);

		assert.strictEqual(registerAnnotationContextKeysMock.mock.calls.length, 1);
		assert.strictEqual(registerAnnotationCommandsMock.mock.calls.length, 1);
		assert.strictEqual(registerCodeLensProviderMock.mock.calls.length, 1);
		assert.deepStrictEqual(registerCodeLensProviderMock.mock.calls[0]?.[0], { scheme: 'file' });
		assert.strictEqual(context.subscriptions.length, 5);

		const contextKeyDependencies = registerAnnotationContextKeysMock.mock.calls[0]?.[1] as {
			getWorkspaceService(workspaceFolder: vscode.WorkspaceFolder): Promise<FakeAnnotationWorkspaceService>;
		};
		const commandDependencies = registerAnnotationCommandsMock.mock.calls[0]?.[1] as {
			getWorkspaceService(workspaceFolder: vscode.WorkspaceFolder): Promise<FakeAnnotationWorkspaceService>;
			contextKeys: typeof contextKeys;
			commentProjection: { refresh: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> };
			inputService: { source: string };
			sessionSelectionService: { presenter: { source: string } };
		};

		const firstService = await contextKeyDependencies.getWorkspaceService(workspaceFolder);
		const secondService = await commandDependencies.getWorkspaceService(workspaceFolder);

		assert.strictEqual(firstService, secondService);
		assert.strictEqual(annotationWorkspaceServiceInstances.length, 1);
		assert.strictEqual(firstService.initializeMock.mock.calls.length, 1);
		assert.deepStrictEqual(annotationStorageControllerArgs, ['e:/source/ai-toolkit']);
		assert.strictEqual(commandDependencies.contextKeys, contextKeys);
		assert.deepStrictEqual(commandDependencies.inputService, { source: 'input-service' });
		assert.deepStrictEqual(commandDependencies.sessionSelectionService.presenter, { source: 'session-quick-pick' });

		const watcherOnChange = vi.fn();
		(firstService.dependencies.watcherFactory as (workspaceFolder: vscode.WorkspaceFolder, onChange: () => void) => unknown)(
			workspaceFolder,
			watcherOnChange,
		);
		assert.strictEqual(createWorkspaceWatcherArgs.length, 1);
		assert.strictEqual(createWorkspaceWatcherArgs[0]?.workspaceFolder, workspaceFolder);
		createWorkspaceWatcherArgs[0]?.onChange();
		assert.strictEqual(watcherOnChange.mock.calls.length, 1);

		firstService.state = { status: 'invalid' };
		firstService.emitDidChangeState();
		await flushAsyncWork();

		assert.strictEqual(contextKeys.refresh.mock.calls.length, 1);
		assert.strictEqual(commandDependencies.commentProjection.refresh.mock.calls.length, 0);

		const projection = { workspaceFolderPath: 'e:/source/ai-toolkit', annotations: [] };
		firstService.state = { status: 'ready', projection };
		firstService.emitDidChangeState();
		await flushAsyncWork();

		assert.strictEqual(contextKeys.refresh.mock.calls.length, 2);
		assert.deepStrictEqual(commandDependencies.commentProjection.refresh.mock.calls, [[projection]]);
		const codeLensProvider = registerCodeLensProviderMock.mock.calls[0]?.[1] as { refresh: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> };
		assert.deepStrictEqual(codeLensProvider.refresh.mock.calls, [[projection]]);

		for (const disposable of context.subscriptions) {
			disposable.dispose();
		}

		assert.strictEqual(firstService.disposeMock.mock.calls.length, 1);
		assert.strictEqual(contextKeys.dispose.mock.calls.length, 1);
		assert.strictEqual(commandDependencies.commentProjection.dispose.mock.calls.length, 1);
		assert.strictEqual(codeLensProvider.dispose.mock.calls.length, 1);
		assert.strictEqual(registerCodeLensProviderDisposable.dispose.mock.calls.length, 1);
	});
});

class FakeAnnotationWorkspaceService {
	public state: { status: string; projection?: unknown } | undefined;
	public readonly initializeMock = vi.fn(async () => this.state);
	public readonly disposeMock = vi.fn();
	private readonly listeners = new Set<StateChangeListener>();

	public constructor(
		public readonly workspaceFolder: vscode.WorkspaceFolder,
		public readonly dependencies: { storage: unknown; watcherFactory: unknown },
	) {
		annotationWorkspaceServiceInstances.push(this);
	}

	public async initialize(): Promise<unknown> {
		return this.initializeMock();
	}

	public onDidChangeState(listener: StateChangeListener): vscode.Disposable {
		this.listeners.add(listener);
		return {
			dispose: () => {
				this.listeners.delete(listener);
			},
		};
	}

	public getState(): unknown {
		return this.state;
	}

	public emitDidChangeState(): void {
		for (const listener of this.listeners) {
			listener();
		}
	}

	public dispose(): void {
		this.disposeMock();
	}

	public get listenerCount(): number {
		return this.listeners.size;
	}
}

function createExtensionContext(): vscode.ExtensionContext {
	return {
		subscriptions: [],
	} as unknown as vscode.ExtensionContext;
}

function createWorkspaceFolder(fsPath: string): vscode.WorkspaceFolder {
	return {
		uri: vscode.Uri.file(fsPath),
		index: 0,
		name: 'ai-toolkit',
	} as vscode.WorkspaceFolder;
}

async function flushAsyncWork(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}