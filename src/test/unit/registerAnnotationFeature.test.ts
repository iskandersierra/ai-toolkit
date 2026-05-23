import * as assert from 'assert';
import * as vscode from 'vscode';
import { vi } from 'vitest';

type StateChangeListener = () => void;
type Spy<TArgs extends unknown[] = unknown[], TResult = void> = ((...args: TArgs) => TResult) & {
	calls: TArgs[];
	reset(): void;
	setImplementation(implementation: (...args: TArgs) => TResult): void;
	setReturnValue(value: TResult): void;
};

const registerAnnotationContextKeysMock = createSpy();
const registerAnnotationCommandsMock = createSpy();
const createVscodeAnnotationInputServiceMock = createSpy();
const createVscodeSessionQuickPickPresenterMock = createSpy();
const registerCodeLensProviderMock = createSpy();
const annotationWorkspaceServiceInstances: FakeAnnotationWorkspaceService[] = [];
const annotationStorageControllerArgs: string[] = [];
const createWorkspaceWatcherArgs: Array<{ workspaceFolder: vscode.WorkspaceFolder; onChange: () => void }> = [];
const commentProjectionInstances: MockProjectionService[] = [];
const codeLensProviderInstances: MockProjectionService[] = [];
const restoreCallbacks: Array<() => void> = [];

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
	AnnotationCommentProjectionService: class extends MockProjectionService {
		public constructor() {
			super(commentProjectionInstances);
		}
	},
}));

vi.mock('../../annotations/presentation/annotationCodeLensProvider', () => ({
	AnnotationCodeLensProvider: class extends MockProjectionService {
		public constructor() {
			super(codeLensProviderInstances);
		}
	},
}));

suite('Register Annotation Feature', () => {
	setup(() => {
		annotationWorkspaceServiceInstances.length = 0;
		annotationStorageControllerArgs.length = 0;
		createWorkspaceWatcherArgs.length = 0;
		commentProjectionInstances.length = 0;
		codeLensProviderInstances.length = 0;
		restoreCallbacks.length = 0;
		registerAnnotationContextKeysMock.reset();
		registerAnnotationCommandsMock.reset();
		createVscodeAnnotationInputServiceMock.reset();
		createVscodeSessionQuickPickPresenterMock.reset();
		registerCodeLensProviderMock.reset();
		const originalRegisterCodeLensProvider = vscode.languages.registerCodeLensProvider;
		restoreCallbacks.push(() => {
			(vscode.languages as { registerCodeLensProvider: typeof vscode.languages.registerCodeLensProvider }).registerCodeLensProvider =
				originalRegisterCodeLensProvider;
		});

		(vscode.languages as { registerCodeLensProvider: typeof vscode.languages.registerCodeLensProvider }).registerCodeLensProvider =
			registerCodeLensProviderMock as typeof vscode.languages.registerCodeLensProvider;
	});

	teardown(() => {
		while (restoreCallbacks.length > 0) {
			restoreCallbacks.pop()?.();
		}
	});

	// Scenario: Given the feature is registered, When workspace services emit invalid then ready state changes, Then registration, reuse, refresh, and disposal all flow through the bootstrap registry.
	test('registers the feature and reuses workspace services across callbacks', async () => {
		const contextKeys = {
			refresh: createSpy<[], Promise<void>>(async () => undefined),
			dispose: createSpy(),
		};
		registerAnnotationContextKeysMock.setReturnValue(contextKeys);
		createVscodeAnnotationInputServiceMock.setReturnValue({ source: 'input-service' });
		createVscodeSessionQuickPickPresenterMock.setReturnValue({ source: 'session-quick-pick' });

		const registerCodeLensProviderDisposable = { dispose: createSpy() };
		registerCodeLensProviderMock.setReturnValue(registerCodeLensProviderDisposable);

		const context = createExtensionContext();
		const workspaceFolder = createWorkspaceFolder('e:/source/ai-toolkit');

		const { registerAnnotationFeature } = await import('../../annotations/bootstrap/registerAnnotationFeature');

		registerAnnotationFeature(context);

		assert.strictEqual(registerAnnotationContextKeysMock.calls.length, 1);
		assert.strictEqual(registerAnnotationCommandsMock.calls.length, 1);
		assert.strictEqual(registerCodeLensProviderMock.calls.length, 1);
		assert.deepStrictEqual(registerCodeLensProviderMock.calls[0]?.[0], { scheme: 'file' });
		assert.strictEqual(context.subscriptions.length, 5);

		const contextKeyDependencies = registerAnnotationContextKeysMock.calls[0]?.[1] as {
			getWorkspaceService(workspaceFolder: vscode.WorkspaceFolder): Promise<FakeAnnotationWorkspaceService>;
		};
		const commandDependencies = registerAnnotationCommandsMock.calls[0]?.[1] as {
			getWorkspaceService(workspaceFolder: vscode.WorkspaceFolder): Promise<FakeAnnotationWorkspaceService>;
			contextKeys: typeof contextKeys;
			commentProjection: MockProjectionService;
			inputService: { source: string };
			sessionSelectionService: unknown;
		};

		const firstService = await contextKeyDependencies.getWorkspaceService(workspaceFolder);
		const secondService = await commandDependencies.getWorkspaceService(workspaceFolder);

		assert.strictEqual(firstService, secondService);
		assert.strictEqual(annotationWorkspaceServiceInstances.length, 1);
		assert.strictEqual(firstService.initializeMock.calls.length, 1);
		assert.deepStrictEqual(annotationStorageControllerArgs, ['e:/source/ai-toolkit']);
		assert.strictEqual(commandDependencies.contextKeys, contextKeys);
		assert.deepStrictEqual(commandDependencies.inputService, { source: 'input-service' });
		assert.ok(commandDependencies.sessionSelectionService);

		const watcherOnChange = createSpy();
		(firstService.dependencies.watcherFactory as (workspaceFolder: vscode.WorkspaceFolder, onChange: () => void) => unknown)(
			workspaceFolder,
			watcherOnChange,
		);
		assert.strictEqual(createWorkspaceWatcherArgs.length, 1);
		assert.strictEqual(createWorkspaceWatcherArgs[0]?.workspaceFolder, workspaceFolder);
		createWorkspaceWatcherArgs[0]?.onChange();
		assert.strictEqual(watcherOnChange.calls.length, 1);

		firstService.state = { status: 'invalid' };
		firstService.emitDidChangeState();
		await flushAsyncWork();

		assert.strictEqual(contextKeys.refresh.calls.length, 1);
		assert.strictEqual(commandDependencies.commentProjection.refresh.calls.length, 0);

		const projection = { workspaceFolderPath: 'e:/source/ai-toolkit', annotations: [] };
		firstService.state = { status: 'ready', projection };
		firstService.emitDidChangeState();
		await flushAsyncWork();

		assert.strictEqual(contextKeys.refresh.calls.length, 2);
		assert.deepStrictEqual(commandDependencies.commentProjection.refresh.calls, [[projection]]);
		const codeLensProvider = codeLensProviderInstances[0];
		assert.deepStrictEqual(codeLensProvider?.refresh.calls, [[projection]]);

		for (const disposable of context.subscriptions) {
			disposable.dispose();
		}

		assert.strictEqual(firstService.disposeMock.calls.length, 1);
		assert.strictEqual(contextKeys.dispose.calls.length, 1);
		assert.strictEqual(commandDependencies.commentProjection.dispose.calls.length, 1);
		assert.strictEqual(codeLensProvider?.dispose.calls.length, 1);
		assert.strictEqual(registerCodeLensProviderDisposable.dispose.calls.length, 1);
	});
});

class FakeAnnotationWorkspaceService {
	public state: { status: string; projection?: unknown } | undefined;
	public readonly initializeMock = createSpy<[], Promise<unknown>>(async () => this.state);
	public readonly disposeMock = createSpy();
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

class MockProjectionService {
	public readonly refresh = createSpy<[unknown], void>();
	public readonly dispose = createSpy();

	public constructor(instances: MockProjectionService[]) {
		instances.push(this);
	}
}

function createSpy<TArgs extends unknown[] = unknown[], TResult = void>(
	implementation?: (...args: TArgs) => TResult,
): Spy<TArgs, TResult> {
	let currentImplementation = implementation;
	const spy = ((...args: TArgs) => {
		spy.calls.push(args);
		return currentImplementation ? currentImplementation(...args) : (undefined as TResult);
	}) as Spy<TArgs, TResult>;

	spy.calls = [];
	spy.reset = () => {
		spy.calls.length = 0;
		currentImplementation = implementation;
	};
	spy.setImplementation = (nextImplementation) => {
		currentImplementation = nextImplementation;
	};
	spy.setReturnValue = (value) => {
		currentImplementation = () => value;
	};

	return spy;
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