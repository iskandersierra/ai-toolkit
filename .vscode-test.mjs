import { defineConfig } from '@vscode/test-cli';
import process from 'node:process';

export default defineConfig({
	files: 'out/test/extension.test.js',
	launchArgs: [process.cwd()],
});
