import { readFileSync } from 'node:fs';
import { dictionaryAnalyzer } from '../../src/lib/analyzer/dictionary';
import { parseWordList } from '../../src/lib/analyzer/wordlist';

/**
 * The analyzer the reader actually reads with, loaded from the committed word list on disk.
 *
 * The shipped one fetches that file over HTTP, which is why `dictionaryAnalyzer` takes a loader
 * rather than a list. This is the same code and the same data by a different route, so a test can
 * exercise real segmentation without a browser or a network. `sameAsShipped` keeps the two from
 * drifting apart silently.
 */
export const diskWordList = parseWordList(readFileSync('static/wordlist-zh.txt', 'utf-8'));
export const diskAnalyzer = dictionaryAnalyzer(() => Promise.resolve(diskWordList));
