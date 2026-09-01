// GitHub Pages serves its own 404 page for any path it has no file for, so a deep link such as
// /read/3 -- a bookmark, or a reload while reading -- would never reach the app. Pages *does*
// serve a repository's own 404.html when it has one, and SvelteKit's client router takes over
// from there. So the fallback shell is published under both names.
//
// This is the one piece of deployment knowledge that has to live in the build rather than in the
// workflow, because `npm run preview` must behave the same way locally.
import { copyFileSync, existsSync } from 'node:fs';

const shell = 'build/index.html';
if (!existsSync(shell)) {
	console.error(`spa-fallback: ${shell} does not exist; did the build run?`);
	process.exit(1);
}

copyFileSync(shell, 'build/404.html');
console.log('spa-fallback: build/404.html written');
