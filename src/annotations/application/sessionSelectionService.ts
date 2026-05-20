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

		return this.selectSession(service);
	}

	public async selectSession(service: AnnotationWorkspaceServiceLike): Promise<SessionSelectionResult> {
		const state = await getReadyState(service);

		if ('status' in state && state.status === 'blocked') {
			return state;
		}

		const choice = await this.presenter.pickSession(createSessionQuickPickItems(state.projection));

		if (!choice) {
			return { status: 'cancelled' };
		}

		if (choice.type === 'create') {
			const name = await this.presenter.promptForNewSessionName();

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