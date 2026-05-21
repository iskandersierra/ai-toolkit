import type { AnnotationProjectionEntry, AnnotationWorkspaceProjection } from './projectionModel';
import type { DraftAnnotationEntry, DraftFileGroup, DraftOutput, DraftOutputFormat } from '../domain/draftShapes';

export interface DraftOutputContent {
	content: string;
	languageId: string;
}

export function generateDraftContent(
	projection: AnnotationWorkspaceProjection,
	format: DraftOutputFormat,
): DraftOutputContent {
	const draft = deriveDraftOutput(projection, format);

	switch (format) {
		case 'json':
			return { content: serializeJson(draft), languageId: 'json' };
		case 'yaml':
			return { content: serializeYaml(draft), languageId: 'yaml' };
		default:
			return { content: serializeMarkdown(draft), languageId: 'markdown' };
	}
}

export function deriveDraftOutput(
	projection: AnnotationWorkspaceProjection,
	format: DraftOutputFormat,
): DraftOutput {
	const activeSession = projection.sessions.find((s) => s.isActive);
	const nonDismissed = projection.activeAnnotations.filter((a) => a.status !== 'dismissed');
	const grouped = groupByFile(nonDismissed);

	return {
		sessionName: activeSession?.name ?? '',
		sessionSlug: activeSession?.sessionSlug ?? '',
		workspaceFolderPath: projection.workspaceFolderPath,
		generatedAt: new Date().toISOString(),
		format,
		files: grouped,
	};
}

function groupByFile(
	annotations: ReadonlyArray<AnnotationProjectionEntry>,
): DraftFileGroup[] {
	const map = new Map<string, DraftAnnotationEntry[]>();

	for (const annotation of annotations) {
		const entries = map.get(annotation.filePath) ?? [];

		entries.push({
			annotationId: annotation.annotationId,
			body: annotation.body,
			status: annotation.status,
			anchorState: annotation.anchorState,
			range: annotation.range,
			updatedAt: annotation.updatedAt,
		});

		map.set(annotation.filePath, entries);
	}

	return Array.from(map.entries()).map(([filePath, entries]) => ({
		filePath,
		annotations: entries,
	}));
}

function serializeMarkdown(draft: DraftOutput): string {
	const lines: string[] = [];

	lines.push(`# Draft Output: ${draft.sessionName}`);
	lines.push('');
	lines.push(`**Workspace**: ${draft.workspaceFolderPath}`);
	lines.push(`**Generated**: ${draft.generatedAt}`);
	lines.push(`**Format**: ${draft.format}`);
	lines.push('');

	const allAnnotations = draft.files.flatMap((f) => f.annotations);
	const activeCount = allAnnotations.filter((a) => a.status === 'active').length;
	const resolvedCount = allAnnotations.filter((a) => a.status === 'resolved').length;
	const anchoredCount = allAnnotations.filter((a) => a.anchorState === 'anchored').length;
	const orphanedCount = allAnnotations.filter((a) => a.anchorState === 'orphaned').length;

	lines.push('## Summary');
	lines.push('');
	lines.push(`| Status   | Count |`);
	lines.push(`|----------|-------|`);
	lines.push(`| Active   | ${activeCount}     |`);
	lines.push(`| Resolved | ${resolvedCount}     |`);
	lines.push(`| Anchored | ${anchoredCount}     |`);
	lines.push(`| Orphaned | ${orphanedCount}     |`);
	lines.push('');

	for (const file of draft.files) {
		lines.push(`## ${file.filePath}`);
		lines.push('');

		for (const annotation of file.annotations) {
			const markers: string[] = [];
			if (annotation.status === 'resolved') {
				markers.push('resolved');
			}
			if (annotation.anchorState === 'orphaned') {
				markers.push('orphaned');
			}

			const suffix = markers.length > 0 ? ` [${markers.join(', ')}]` : '';
			lines.push(`### Annotation${suffix}`);
			lines.push('');
			lines.push(`**Range**: L${annotation.range.start.line + 1}:${annotation.range.start.character}-L${annotation.range.end.line + 1}:${annotation.range.end.character}`);
			lines.push('');
			lines.push(annotation.body);
			lines.push('');
		}
	}

	return lines.join('\n');
}

function serializeJson(draft: DraftOutput): string {
	return JSON.stringify(draft, null, 2);
}

function serializeYaml(draft: DraftOutput): string {
	const lines: string[] = [];

	lines.push(`sessionName: ${yamlScalar(draft.sessionName)}`);
	lines.push(`sessionSlug: ${yamlScalar(draft.sessionSlug)}`);
	lines.push(`workspaceFolderPath: ${yamlScalar(draft.workspaceFolderPath)}`);
	lines.push(`generatedAt: ${yamlScalar(draft.generatedAt)}`);
	lines.push(`format: ${yamlScalar(draft.format)}`);
	lines.push('files:');

	for (const file of draft.files) {
		lines.push(`  - filePath: ${yamlScalar(file.filePath)}`);
		lines.push('    annotations:');

		for (const annotation of file.annotations) {
			lines.push(`      - annotationId: ${yamlScalar(annotation.annotationId)}`);
			lines.push(`        body: ${yamlScalar(annotation.body)}`);
			lines.push(`        status: ${yamlScalar(annotation.status)}`);
			lines.push(`        anchorState: ${yamlScalar(annotation.anchorState)}`);
			lines.push('        range:');
			lines.push('          start:');
			lines.push(`            line: ${annotation.range.start.line}`);
			lines.push(`            character: ${annotation.range.start.character}`);
			lines.push('          end:');
			lines.push(`            line: ${annotation.range.end.line}`);
			lines.push(`            character: ${annotation.range.end.character}`);
			lines.push(`        updatedAt: ${yamlScalar(annotation.updatedAt)}`);
		}
	}

	return lines.join('\n') + '\n';
}

function yamlScalar(value: string): string {
	if (
		value === '' ||
		value.includes(':') ||
		value.includes('#') ||
		value.includes('\r') ||
		value.includes('\n') ||
		value.includes('"') ||
		value.includes("'") ||
		/^\s|^\{|^\[|^true$|^false$|^null$|^[\d.]+$/.test(value)
	) {
		return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n')}"`;
	}

	return value;
}
