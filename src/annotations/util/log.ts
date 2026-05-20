export interface AnnotationLogger {
	info(message: string, details?: Record<string, unknown>): void;
	warn(message: string, details?: Record<string, unknown>): void;
	error(message: string, details?: Record<string, unknown>): void;
}

export function createAnnotationLogger(label = 'AI Toolkit annotations'): AnnotationLogger {
	return {
		info: (message, details) => {
			console.info(formatAnnotationLogMessage(label, 'info', message, details));
		},
		warn: (message, details) => {
			console.warn(formatAnnotationLogMessage(label, 'warn', message, details));
		},
		error: (message, details) => {
			console.error(formatAnnotationLogMessage(label, 'error', message, details));
		},
	};
	}

export function logInvalidAnnotationStore(
	logger: AnnotationLogger,
	storePath: string,
	error: Error,
): void {
	logger.error('Invalid annotation store content blocked reload and writes.', {
		storePath,
		error: error.message,
	});
	}

export function logAnnotationStoreReload(
	logger: AnnotationLogger,
	storePath: string,
	reason: 'created' | 'changed' | 'deleted' | 'load' | 'migration',
): void {
	logger.info('Reloading annotation store state.', {
		storePath,
		reason,
	});
	}

export function logAnnotationStoreConflict(logger: AnnotationLogger, storePath: string): void {
	logger.warn('Annotation store write conflict detected.', {
		storePath,
	});
	}

function formatAnnotationLogMessage(
	label: string,
	level: 'info' | 'warn' | 'error',
	message: string,
	details?: Record<string, unknown>,
): string {
	const suffix = details ? ` ${JSON.stringify(details)}` : '';
	return `[${label}] ${level.toUpperCase()}: ${message}${suffix}`;
	}