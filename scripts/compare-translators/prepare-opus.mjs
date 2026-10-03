import { build } from 'vite';
const [runtimeRoot] = process.argv.slice(2);
await build({
	configFile: false,
	logLevel: 'error',
	build: {
		outDir: `${runtimeRoot}/app-code`,
		lib: { entry: 'src/lib/translation/opus.ts', formats: ['es'], fileName: 'opus' },
		minify: false
	}
});
await build({
	configFile: false,
	logLevel: 'error',
	build: {
		outDir: `${runtimeRoot}/tokenizer-code`,
		lib: { entry: 'src/lib/translation/unigram.ts', formats: ['es'], fileName: 'unigram' },
		minify: false
	}
});
