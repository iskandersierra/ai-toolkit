import type {
	AnnotationEntry,
	AnnotationSession,
	AnnotationStore,
} from '../domain/annotationModels';

export interface AnnotationSessionProjection {
	sessionId: string;
	name: string;
	sessionSlug: string;
	isActive: boolean;
	annotationCount: number;
	dismissedCount: number;
	updatedAt: string;
}

export interface AnnotationProjectionEntry {
	annotationId: string;
	sessionId: string;
	sessionName: string;
	status: AnnotationEntry['status'];
	anchorState: AnnotationEntry['anchorState'];
	body: string;
	filePath: string;
	range: AnnotationEntry['anchor']['range'];
	updatedAt: string;
	isActiveSession: boolean;
}

export interface AnnotationWorkspaceProjection {
	workspaceFolderPath: string;
	storeContentHash?: string;
	activeSessionId: string | null;
	sessions: AnnotationSessionProjection[];
	annotations: AnnotationProjectionEntry[];
	activeAnnotations: AnnotationProjectionEntry[];
	dismissedAnnotationsInActiveSession: number;
}

export function deriveAnnotationWorkspaceProjection(
	workspaceFolderPath: string,
	store: AnnotationStore,
	storeContentHash?: string,
): AnnotationWorkspaceProjection {
	const sessions = store.sessions.map((session) => projectSession(session, store.activeSessionId));
	const annotations = store.sessions.flatMap((session) =>
		session.annotations.map((annotation) => projectAnnotation(annotation, session, store.activeSessionId)),
	);

	return {
		workspaceFolderPath,
		storeContentHash,
		activeSessionId: store.activeSessionId,
		sessions,
		annotations,
		activeAnnotations: annotations.filter((annotation) => annotation.isActiveSession),
		dismissedAnnotationsInActiveSession: annotations.filter(
			(annotation) => annotation.isActiveSession && annotation.status === 'dismissed',
		).length,
	};
}

function projectSession(
	session: AnnotationSession,
	activeSessionId: string | null,
): AnnotationSessionProjection {
	return {
		sessionId: session.sessionId,
		name: session.name,
		sessionSlug: session.sessionSlug,
		isActive: session.sessionId === activeSessionId,
		annotationCount: session.annotations.length,
		dismissedCount: session.annotations.filter((annotation) => annotation.status === 'dismissed').length,
		updatedAt: session.updatedAt,
	};
}

function projectAnnotation(
	annotation: AnnotationEntry,
	session: AnnotationSession,
	activeSessionId: string | null,
): AnnotationProjectionEntry {
	return {
		annotationId: annotation.annotationId,
		sessionId: session.sessionId,
		sessionName: session.name,
		status: annotation.status,
		anchorState: annotation.anchorState,
		body: annotation.body,
		filePath: annotation.filePath,
		range: annotation.anchor.range,
		updatedAt: annotation.updatedAt,
		isActiveSession: session.sessionId === activeSessionId,
	};
}