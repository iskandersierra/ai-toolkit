import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';

Object.assign(globalThis, {
	setup: beforeEach,
	teardown: afterEach,
	suiteSetup: beforeAll,
	suiteTeardown: afterAll,
});