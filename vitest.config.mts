import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: [
			'src/test/unit/anchorMatching.test.ts',
			'src/test/unit/annotationContextKeys.test.ts',
			'src/test/unit/annotationProjection.test.ts',
			'src/test/unit/annotationStorageController.test.ts',
			'src/test/unit/annotationTargeting.test.ts',
			'src/test/unit/annotationValidation.test.ts',
			'src/test/unit/annotationWorkspaceService.test.ts',
			'src/test/unit/draftOutputService.test.ts',
		],
		setupFiles: ['src/test/vitest.setup.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json-summary', 'html'],
			reportsDirectory: 'coverage',
			include: ['src/**/*.ts'],
			exclude: [
				'src/test/**',
			],
		},
		alias: {
			vscode: path.resolve('src/test/support/vscode.mock.ts'),
		},
	},
});