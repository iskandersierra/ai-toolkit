import * as assert from 'assert';
import { vi } from 'vitest';

const registerAnnotationFeatureMock = vi.fn();

vi.mock('../../annotations/bootstrap/registerAnnotationFeature', () => ({
	registerAnnotationFeature: registerAnnotationFeatureMock,
}));

suite('Extension Entry Point', () => {
	setup(() => {
		registerAnnotationFeatureMock.mockReset();
	});

	// Scenario: Given extension activation, When activate runs, Then it delegates bootstrap to the annotation feature registrar.
	test('activate delegates to registerAnnotationFeature', async () => {
		const context = { subscriptions: [] };
		const extension = await import('../../extension');

		extension.activate(context as never);

		assert.deepStrictEqual(registerAnnotationFeatureMock.mock.calls, [[context]]);
	});

	// Scenario: Given extension shutdown, When deactivate runs, Then it completes as a no-op without throwing.
	test('deactivate is a no-op', async () => {
		const extension = await import('../../extension');

		assert.doesNotThrow(() => extension.deactivate());
	});
});