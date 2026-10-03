// Both candidates see the same marked sentence, question and option text, so differences come from the model.
export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Options that give no meaning but say why a lookup would fail or how to find the meaning.
const META = {
	none: 'none of the listed senses fits',
	segment:
		'the marked text is not a whole word here (it is part of a longer word, name or expression, or cuts across words)',
	compositional: "the meaning here is simply its characters' meanings combined"
};

// forced: real senses only. none: senses + "none". meta: senses + every applicable meta option.
export const VARIANTS = ['forced', 'none', 'meta'];

// trim: drop senses a reader never needs in context, and example lists, to shorten the prompt.
const NOT_A_MEANING =
	/^[^:]+: (surname |(old )?variant of |see |used in |Taiwan pr\.|also pr\.|CL:|abbr\. for |Kangxi radical)/;
const shorten = (s) => s.replace(/ ?\((e\.g\.|CL:)[^()]*(\([^()]*\)[^()]*)*\)/g, '');

export function question(item, variant, { trim = false } = {}) {
	const meta =
		variant === 'forced'
			? []
			: variant === 'none'
				? ['none']
				: ['none', 'segment', ...([...item.word].length > 1 ? ['compositional'] : [])];
	const kept = item.senses
		.map((s, i) => i)
		.filter((i) => !trim || !NOT_A_MEANING.test(item.senses[i]));
	const senses = kept.map((i) => (trim ? shorten(item.senses[i]) : item.senses[i]));
	const options = [...senses, ...meta.map((m) => META[m])];
	const gold = [
		...item.gold.map((g) => kept.indexOf(g)).filter((g) => g >= 0),
		...meta.flatMap((m, i) => (item.goldMeta.includes(m) ? [senses.length + i] : []))
	];
	return { options, gold, metaKeys: meta };
}

export function markedSentence(item) {
	const end = item.start + item.word.length;
	return item.sentence.slice(0, item.start) + '【' + item.word + '】' + item.sentence.slice(end);
}

export function instruction(item) {
	return `Which dictionary sense of the Chinese word ${item.word} (marked 【】) is meant in this sentence?`;
}

export function summarize(item, q, probabilities) {
	const pick = probabilities.indexOf(Math.max(...probabilities));
	return {
		id: item.id,
		pick,
		// Unscored when the variant offers no acceptable answer, e.g. a name fragment under forced choice.
		correct: q.gold.length ? q.gold.includes(pick) : null,
		pGold: q.gold.length ? q.gold.reduce((s, g) => s + probabilities[g], 0) : null,
		probabilities
	};
}
