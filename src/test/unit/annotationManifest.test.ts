import * as assert from 'assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

type MenuContribution = {
	command?: string;
	group?: string;
	when?: string;
};

type ExtensionManifest = {
	contributes?: {
		menus?: Record<string, MenuContribution[] | undefined>;
	};
};

suite('Annotation Manifest', () => {
	// Scenario: Given annotation comment menus are contributed in the extension manifest, When the manifest is loaded, Then comment and comment-thread surfaces expose the same supported lifecycle commands while excluding reanchor.
	test('keeps comment and comment-thread annotation actions in sync', () => {
		const manifest = JSON.parse(
			fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
		) as ExtensionManifest;

		const menus = manifest.contributes?.menus;
		const threadCommands = getMenuCommands(menus?.['comments/commentThread/context']);
		const commentCommands = getMenuCommands(menus?.['comments/comment/context']);

		assert.deepStrictEqual(threadCommands, [
			'ai-toolkit.addOrEditAnnotation',
			'ai-toolkit.resolveAnnotation',
			'ai-toolkit.reopenAnnotation',
			'ai-toolkit.dismissAnnotation',
		]);
		assert.deepStrictEqual(commentCommands, threadCommands);
		assert.ok(!commentCommands.includes('ai-toolkit.reanchorAnnotation'));
	});
});

function getMenuCommands(contributions: MenuContribution[] | undefined): string[] {
	return (contributions ?? []).flatMap((contribution) =>
		typeof contribution.command === 'string' ? [contribution.command] : [],
	);
}