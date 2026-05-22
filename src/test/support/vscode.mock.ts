import path from 'node:path';

type Disposable = { dispose(): void };

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const fileContents = new Map<string, Uint8Array>();
let untitledDocumentCounter = 0;

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

	public static untitled(id: string): Uri {
		return new Uri(id, 'untitled');
	}

	public toString(): string {
		return this.scheme === 'file' ? this.fsPath : `${this.scheme}:${this.fsPath}`;
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
		const start = new Position(startLine, startCharacter);
		const end = new Position(endLine, endCharacter);
		const [normalizedStart, normalizedEnd] = comparePositions(start, end) <= 0
			? [start, end]
			: [end, start];
		this.start = normalizedStart;
		this.end = normalizedEnd;
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

class TextLine {
	public constructor(public readonly text: string) {}
}

class TextDocument {
	public readonly lineCount: number;

	private readonly lines: string[];

	public constructor(
		public readonly uri: Uri,
		private text: string,
		public readonly languageId = 'plaintext',
	) {
		this.lines = splitLines(text);
		this.lineCount = this.lines.length;
	}

	public getText(range?: Range): string {
		if (!range) {
			return this.text;
		}

		const normalizedRange = normalizeRange(range);
		const selectedLines = this.lines.slice(normalizedRange.start.line, normalizedRange.end.line + 1);

		if (selectedLines.length === 0) {
			return '';
		}

		selectedLines[0] = selectedLines[0]?.slice(normalizedRange.start.character) ?? '';
		selectedLines[selectedLines.length - 1] =
			selectedLines[selectedLines.length - 1]?.slice(0, normalizedRange.end.character) ?? '';

		return selectedLines.join('\n');
	}

	public lineAt(line: number): TextLine {
		return new TextLine(this.lines[line] ?? '');
	}

	public update(text: string): void {
		this.text = text;
		this.lines.splice(0, this.lines.length, ...splitLines(text));
		(this as { lineCount: number }).lineCount = this.lines.length;
	}

	public save(): Promise<boolean> {
		if (this.uri.scheme === 'file') {
			fileContents.set(this.uri.fsPath, textEncoder.encode(this.text));
		}

		return Promise.resolve(true);
	}
}

class TextEditor {
	public selection: Selection;

	public constructor(public readonly document: TextDocument) {
		const origin = new Position(0, 0);
		this.selection = new Selection(origin, origin);
	}
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

export const CommentThreadCollapsibleState = {
	Collapsed: 0,
	Expanded: 1,
};

export const workspace = {
	workspaceFolders,
	fs: {
		writeFile: async (uri: Uri, content: Uint8Array) => {
			fileContents.set(uri.fsPath, content);
		},
		readFile: async (uri: Uri) => fileContents.get(uri.fsPath) ?? new Uint8Array(),
		delete: async (uri: Uri) => {
			fileContents.delete(uri.fsPath);
		},
	},
	getConfiguration: () => ({
		get: <T>(_section: string, defaultValue: T) => defaultValue,
	}),
	openTextDocument: async (input: Uri | { content: string; language?: string }) => {
		if (input instanceof Uri) {
			const existingContent = fileContents.get(input.fsPath);
			return new TextDocument(input, textDecoder.decode(existingContent ?? new Uint8Array()));
		}

		untitledDocumentCounter += 1;
		return new TextDocument(Uri.untitled(`untitled-${untitledDocumentCounter}`), input.content, input.language);
	},
	getWorkspaceFolder: (uri: Uri) => {
		const match = workspaceFolders.find((folder) => isWithin(folder.uri.fsPath, uri.fsPath));
		return match;
	},
};

export const window = {
	activeTextEditor: undefined,
	onDidChangeActiveTextEditor: () => ({ dispose() {} }),
	onDidChangeTextEditorSelection: () => ({ dispose() {} }),
	showTextDocument: async (document: TextDocument) => {
		const editor = new TextEditor(document);
		window.activeTextEditor = editor;
		return editor;
	},
	showErrorMessage: async () => undefined,
	showInformationMessage: async () => undefined,
	showWarningMessage: async () => undefined,
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

function comparePositions(left: Position, right: Position): number {
	if (left.line !== right.line) {
		return left.line - right.line;
	}

	return left.character - right.character;
}

function normalizeRange(range: Range): Range {
	if (range.start.line < range.end.line) {
		return range;
	}

	if (range.start.line === range.end.line && range.start.character <= range.end.character) {
		return range;
	}

	return new Range(range.end.line, range.end.character, range.start.line, range.start.character);
}

function splitLines(text: string): string[] {
	return text.length === 0 ? [''] : text.split(/\r?\n/);
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