import type { AnnotationAnchorState, AnnotationRange, AnnotationStatus } from './annotationModels';

export type DraftOutputFormat = 'markdown' | 'json' | 'yaml';

export interface DraftAnnotationEntry {
	annotationId: string;
	body: string;
	status: AnnotationStatus;
	anchorState: AnnotationAnchorState;
	range: AnnotationRange;
	updatedAt: string;
}

export interface DraftFileGroup {
	filePath: string;
	annotations: DraftAnnotationEntry[];
}

export interface DraftOutput {
	sessionName: string;
	sessionSlug: string;
	workspaceFolderPath: string;
	generatedAt: string;
	format: DraftOutputFormat;
	files: DraftFileGroup[];
}
