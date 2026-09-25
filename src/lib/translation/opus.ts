/**
 * Translating one line with opus-mt-zh-en: the quick English that is there within seconds, until
 * the local LLM's line replaces it (ADR-0023, constitution Principle VIII).
 *
 * Greedy decoding over the model's encoder and its merged decoder, whose `use_cache_branch` input
 * switches between the first step (no past) and every later one (reusing the keys and values it
 * returned). Written against the runtime's interface, not an import of it, so the same code runs
 * in the browser worker and in Node for checking.
 */

import type * as Ort from 'onnxruntime-web';
import { decode, encode, type Vocabulary } from './unigram';

const END = 0;
const START = 65000; // also the padding id, which must never be generated
const LAYERS = 6;
const HEADS = 8;
const HEAD_SIZE = 64;

export interface OpusModel {
	ort: typeof Ort;
	encoder: Ort.InferenceSession;
	decoder: Ort.InferenceSession;
	vocabulary: Vocabulary;
}

export async function translateLine(text: string, model: OpusModel): Promise<string> {
	const { ort, encoder, decoder, vocabulary } = model;
	const source = [...encode(text, vocabulary), END];
	if (source.length === 1) return '';
	const shape = [1, source.length];
	const mask = new ort.Tensor('int64', new BigInt64Array(source.length).fill(1n), shape);

	const { last_hidden_state: encoded } = await encoder.run({
		input_ids: new ort.Tensor('int64', BigInt64Array.from(source, BigInt), shape),
		attention_mask: mask
	});

	const empty = () => new ort.Tensor('float32', new Float32Array(0), [1, HEADS, 0, HEAD_SIZE]);
	let past: Record<string, Ort.Tensor> = {};
	for (let layer = 0; layer < LAYERS; layer++)
		for (const part of ['decoder.key', 'decoder.value', 'encoder.key', 'encoder.value'])
			past[`past_key_values.${layer}.${part}`] = empty();

	const generated: number[] = [];
	let previous = START;
	// Subtitle lines are short; this only stops a model that never ends a sentence.
	const limit = 2 * source.length + 10;
	for (let step = 0; step < limit; step++) {
		const output = await decoder.run({
			input_ids: new ort.Tensor('int64', BigInt64Array.of(BigInt(previous)), [1, 1]),
			encoder_hidden_states: encoded,
			encoder_attention_mask: mask,
			use_cache_branch: new ort.Tensor('bool', [step > 0], [1]),
			...past
		});
		const next = best(output.logits.data as Float32Array);
		if (next === END) break;
		generated.push(next);
		previous = next;

		// The encoder's keys and values are computed once, on the first step; after that the cache
		// branch returns them unchanged or empty, so the first step's copies are kept.
		const kept: Record<string, Ort.Tensor> = {};
		for (let layer = 0; layer < LAYERS; layer++)
			for (const part of ['decoder.key', 'decoder.value', 'encoder.key', 'encoder.value']) {
				const name = `${layer}.${part}`;
				kept[`past_key_values.${name}`] =
					step > 0 && part.startsWith('encoder')
						? past[`past_key_values.${name}`]
						: output[`present.${name}`];
			}
		past = kept;
	}
	return decode(generated, vocabulary);
}

/** The most likely next id, never the padding id (the model's `bad_words_ids`). */
function best(logits: Float32Array): number {
	let top = -1;
	let topScore = -Infinity;
	for (let id = 0; id < logits.length; id++) {
		if (id !== START && logits[id] > topScore) {
			topScore = logits[id];
			top = id;
		}
	}
	return top;
}
