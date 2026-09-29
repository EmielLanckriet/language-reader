import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

afterEach(() => {
	vi.unstubAllEnvs();
	vi.resetModules();
});

it('uses a separate service for verification and cannot launch the real Termux helper', async () => {
	vi.stubEnv('MODE', 'verification');
	const { SERVICE } = await import('../../src/lib/media/service-address');
	expect(SERVICE).toBe('http://127.0.0.1:18765');
	const { startWithHelper, startBySharing, canShareToTermux, helperExpected } =
		await import('../../src/lib/media/service');
	expect(await startWithHelper()).toBe(false);
	expect(await startBySharing()).toBe(false);
	expect(canShareToTermux()).toBe(false);
	expect(helperExpected()).toBe(false);
});

it('keeps the daily reader service unchanged', async () => {
	vi.stubEnv('MODE', 'production');
	const { SERVICE } = await import('../../src/lib/media/service-address');
	expect(SERVICE).toBe('http://127.0.0.1:8765');
});

it('has no service callers bypassing the shared address', () => {
	const files = readdirSync('src', { recursive: true })
		.map(String)
		.filter((file) => /\.(ts|svelte)$/.test(file) && !file.endsWith('service-address.ts'));
	const bypasses = files.filter((file) =>
		/127\.0\.0\.1:8765/.test(readFileSync(join('src', file), 'utf8'))
	);
	expect(bypasses).toEqual([]);
});
