// Every route reads from SQLite in the browser's origin-private file system, which exists only
// on the reader's device. There is nothing a server or a build machine could render, so both
// server-side rendering and prerendering are off for the whole app.
export const ssr = false;
export const prerender = false;
