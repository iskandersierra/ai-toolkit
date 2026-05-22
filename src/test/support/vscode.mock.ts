import path from 'node:path';

type Disposable = { dispose(): void };

class Uri {
	public readonly scheme: string;
	public readonly fsPath: string;

	private constructor(fsPath: string, scheme = 'file') {
		this.scheme = scheme;
		this.fsPath = normalizeFsPath(fsPath);
	}

	public static file(fsPath: string): Uri {
		return new Uri(fsPath);
	}
}

class Position {
	public constructor(
		public readonly line: number,
		public readonly character: number,
	) {}
}

class Range {
	public readonly start: Position;
	public readonly end: Position;

	public constructor(
		startLine: number,
		startCharacter: number,
		endLine: number,
		endCharacter: number,
	) {
		this.start = new Position(startLine, startCharacter);
		this.end = new Position(endLine, endCharacter);
	}
}

class Selection extends Range {
	public readonly anchor: Position;
	public readonly active: Position;

	public constructor(anchor: Position, active: Position) {
		super(anchor.line, anchor.character, active.line, active.character);
		this.anchor = anchor;
		this.active = active;
	}

	public get isEmpty(): boolean {
		return this.anchor.line === this.active.line && this.anchor.character === this.active.character;
	}

	public get isReversed(): boolean {
		if (this.anchor.line !== this.active.line) {
			return this.anchor.line > this.active.line;
		}

		return this.anchor.character > this.active.character;
	}
}

class EventEmitter<T> {
	private readonly listeners = new Set<(value: T) => void>();

	public readonly event = (listener: (value: T) => void): Disposable => {
		this.listeners.add(listener);
		return {
			dispose: () => {
				this.listeners.delete(listener);
			},
		};
	};

	public fire(value: T): void {
		for (const listener of this.listeners) {
			listener(value);
		}
	}

	public dispose(): void {
		this.listeners.clear();
	}
}

class CodeLens {
	public constructor(
		public readonly range: Range,
		public readonly command?: { title: string; command: string; arguments?: unknown[] },
	) {}
}

const workspaceFolders = [{
	uri: Uri.file(process.cwd()),
	index: 0,
	name: path.basename(process.cwd()),
}];

export const CommentMode = {
	Preview: 0,
};

export const CommentThreadState = {
	Unresolved: 0,
	Resolved: 1,
};

export const workspace = {
	workspaceFolders,
	getConfiguration: () => ({
		get: <T>(_section: string, defaultValue: T) => defaultValue,
	}),
	getWorkspaceFolder: (uri: Uri) => {
		const match = workspaceFolders.find((folder) => isWithin(folder.uri.fsPath, uri.fsPath));
		return match;
	},
};

export const window = {
	activeTextEditor: undefined,
	onDidChangeActiveTextEditor: () => ({ dispose() {} }),
	onDidChangeTextEditorSelection: () => ({ dispose() {} }),
};

export const commands = {
	executeCommand: async () => undefined,
	registerCommand: () => ({ dispose() {} }),
};

export const comments = {
	createCommentController: () => ({
		createCommentThread: () => ({
			canReply: false,
			comments: [],
			contextValue: undefined,
			label: undefined,
			state: undefined,
			dispose() {},
		}),
		dispose() {},
	}),
};

function normalizeFsPath(fsPath: string): string {
	return path.normalize(fsPath).replace(/\\/g, '/').toLowerCase();
}

function isWithin(rootPath: string, childPath: string): boolean {
	const normalizedRoot = normalizeFsPath(rootPath);
	const normalizedChild = normalizeFsPath(childPath);
	return normalizedChild === normalizedRoot || normalizedChild.startsWith(`${normalizedRoot}/`);
}

export {
	CodeLens,
	EventEmitter,
	Position,
	Range,
	Selection,
	Uri,
};