import type { AnnotationAnchorState, AnnotationRange, AnnotationStatus } from './annotationModels';

export type DraftOutputFormat = 'markdown' | 'json' | 'yaml';

export type DraftTrustSource = 'system-derived' | 'user-authored';

export type DraftMarkdownPlacement = 'trusted-header' | 'untrusted-metadata' | 'fenced-untrusted-content';

export interface DraftFieldTrustMetadata {
	source: DraftTrustSource;
	markdownPlacement: DraftMarkdownPlacement;
}

export interface DraftAnnotationEntry {
	annotationId: string;
	body: string;
	status: AnnotationStatus;
	anchorState: AnnotationAnchorState;
	range: AnnotationRange;
	updatedAt: string;
	trustMetadata: {
		body: DraftFieldTrustMetadata;
	};
}

export interface DraftFileGroup {
	filePath: string;
	trustMetadata: {
		filePath: DraftFieldTrustMetadata;
	};
	annotations: DraftAnnotationEntry[];
}

export interface DraftOutput {
	sessionName: string;
	sessionSlug: string;
	workspaceFolderPath: string;
	generatedAt: string;
	format: DraftOutputFormat;
	trustMetadata: {
		sessionName: DraftFieldTrustMetadata;
		sessionSlug: DraftFieldTrustMetadata;
		workspaceFolderPath: DraftFieldTrustMetadata;
	};
	files: DraftFileGroup[];
}
