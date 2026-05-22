import type {
	AnnotationWorkspaceBlockedResult,
	AnnotationWorkspaceMutationResult,
	AnnotationWorkspaceReadyState,
	AnnotationWorkspaceServiceLike,
} from './annotationWorkspaceService';
import type { AnnotationWorkspaceProjection } from './projectionModel';
import {
	createSessionQuickPickItems,
	type SessionQuickPickPresenter,
} from '../presentation/sessionQuickPick';

const defaultReviewSessionName = 'Review Session';
const defaultReviewSessionNamePattern = /^Review Session(?: (\d+))?$/;

export type SessionSelectionResult =
	| {
		status: 'ready';
		sessionId: string;
		created: boolean;
		projection: AnnotationWorkspaceProjection;
	}
	| {
		status: 'cancelled';
	}
	| AnnotationWorkspaceBlockedResult;

export class SessionSelectionService {
	public constructor(private readonly presenter: SessionQuickPickPresenter) {}

	public getNextDefaultSessionName(projection: AnnotationWorkspaceProjection): string {
		let highestSequence = 0;

		for (const session of projection.sessions) {
			const match = defaultReviewSessionNamePattern.exec(session.name);
			if (!match) {
				continue;
			}

			const sequence = match[1] ? Number.parseInt(match[1], 10) : 1;
			highestSequence = Math.max(highestSequence, sequence);
		}

		if (highestSequence === 0) {
			return defaultReviewSessionName;
		}

		return `${defaultReviewSessionName} ${highestSequence + 1}`;
	}

	public async ensureActiveSession(service: AnnotationWorkspaceServiceLike): Promise<SessionSelectionResult> {
		const state = await getReadyState(service);

		if ('status' in state && state.status === 'blocked') {
			return state;
		}

		if (state.projection.activeSessionId) {
			return {
				status: 'ready',
				sessionId: state.projection.activeSessionId,
				created: false,
				projection: state.projection,
			};
		}

		if (state.projection.sessions.length === 0) {
			const result = await service.createSession(defaultReviewSessionName);
			return toSessionSelectionResult(result, true);
		}

		return this.selectSessionFromState(service, state);
	}

	public async selectSession(service: AnnotationWorkspaceServiceLike): Promise<SessionSelectionResult> {
		const state = await getReadyState(service);

		if ('status' in state && state.status === 'blocked') {
			return state;
		}

		return this.selectSessionFromState(service, state);
	}

	private async selectSessionFromState(
		service: AnnotationWorkspaceServiceLike,
		state: AnnotationWorkspaceReadyState,
	): Promise<SessionSelectionResult> {
		const suggestedName = this.getNextDefaultSessionName(state.projection);

		const choice = await this.presenter.pickSession(createSessionQuickPickItems(state.projection));

		if (!choice) {
			return { status: 'cancelled' };
		}

		if (choice.type === 'create') {
			const name = await this.presenter.promptForNewSessionName(suggestedName);

			if (!name) {
				return { status: 'cancelled' };
			}

			const result = await service.createSession(name);
			return toSessionSelectionResult(result, true);
		}

		const result = await service.setActiveSession(choice.sessionId);
		return toSessionSelectionResult(result, false);
	}
}

async function getReadyState(
	service: AnnotationWorkspaceServiceLike,
): Promise<AnnotationWorkspaceReadyState | AnnotationWorkspaceBlockedResult> {
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

function toSessionSelectionResult(
	result: AnnotationWorkspaceMutationResult,
	created: boolean,
): SessionSelectionResult {
	if (result.status === 'blocked') {
		return result;
	}

	if (!result.sessionId) {
		return {
			status: 'blocked',
			reason: 'sessionNotFound',
			message: 'The review session operation completed without a session identifier.',
			storePath: result.storePath,
		};
	}

	return {
		status: 'ready',
		sessionId: result.sessionId,
		created,
		projection: result.projection,
	};
}