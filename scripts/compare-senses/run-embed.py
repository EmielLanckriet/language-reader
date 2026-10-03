"""Zero-shot bi-encoder sense picking: compare the context with each English gloss by cosine similarity.

Usage: <python with torch+transformers> scripts/compare-senses/run-embed.py <hf-cache-dir> <out-dir>
Writes <out-dir>/embed-<model>-<mode>.json for bge-m3 and multilingual-e5-small, forced variant only.

Modes: 'sentence' embeds the whole marked sentence; 'token' takes the target word's own token vectors
from inside the unmarked sentence (the BEM idea). Glosses never depend on the sentence, so on a phone
they would be embedded once ahead of time; their encoding time is reported separately.
"""
import json
import os
import sys
import time

import torch
from transformers import AutoModel, AutoTokenizer

torch.set_num_threads(4)
HERE = os.path.dirname(os.path.abspath(__file__))
cache, out_dir = sys.argv[1], sys.argv[2]
items = json.load(open(os.path.join(HERE, 'items.json'), encoding='utf8'))
MODELS = {
    'bge-m3': {'repo': 'BAAI/bge-m3', 'pool': 'cls', 'query': '', 'passage': ''},
    'e5-small': {'repo': 'intfloat/multilingual-e5-small', 'pool': 'mean', 'query': 'query: ', 'passage': 'passage: '},
}


def marked(item):
    s, a, b = item['sentence'], item['start'], item['start'] + len(item['word'])
    return s[:a] + '【' + s[a:b] + '】' + s[b:]


def gloss(item, sense):
    return f"{item['word']}: {sense.split(': ', 1)[1]}"


def main():
    for name, m in MODELS.items():
        tok = AutoTokenizer.from_pretrained(m['repo'], cache_dir=cache)
        model = AutoModel.from_pretrained(m['repo'], cache_dir=cache).eval()

        @torch.no_grad()
        def encode(texts):
            batch = tok(texts, padding=True, truncation=True, max_length=512, return_tensors='pt', return_offsets_mapping=True)
            offsets = batch.pop('offset_mapping')
            hidden = model(**batch).last_hidden_state
            mask = batch['attention_mask'].unsqueeze(-1).float()
            pooled = hidden[:, 0] if m['pool'] == 'cls' else (hidden * mask).sum(1) / mask.sum(1)
            return torch.nn.functional.normalize(pooled, dim=-1), hidden, offsets

        def span_vector(text, start, end):
            _, hidden, offsets = encode([text])
            idx = [i for i, (a, b) in enumerate(offsets[0].tolist()) if b > a and a < end and b > start]
            return torch.nn.functional.normalize(hidden[0, idx].mean(0), dim=-1)

        for mode in ('sentence', 'token'):
            rows = []
            for item in items:
                if len(item['senses']) < 2 or not item['gold']:
                    continue
                t = time.perf_counter()
                if mode == 'sentence':
                    ctx = encode([m['query'] + marked(item)])[0][0]
                else:
                    pre = len(m['query'])
                    ctx = span_vector(m['query'] + item['sentence'], pre + item['start'], pre + item['start'] + len(item['word']))
                ctx_ms = (time.perf_counter() - t) * 1000
                t = time.perf_counter()
                glosses = encode([m['passage'] + gloss(item, s) for s in item['senses']])[0]
                gloss_ms = (time.perf_counter() - t) * 1000
                sims = (glosses @ ctx).tolist()
                pick = max(range(len(sims)), key=sims.__getitem__)
                probs = torch.softmax(torch.tensor(sims) / 0.05, 0).tolist()  # temperature only for a comparable spread
                rows.append({'id': item['id'], 'pick': pick, 'correct': pick in item['gold'], 'similarities': sims,
                             'probabilities': probs, 'contextMs': ctx_ms, 'glossMs': gloss_ms})
            path = os.path.join(out_dir, f'embed-{name}-{mode}.json')
            json.dump({'engine': name, 'mode': mode, 'parameters': sum(p.numel() for p in model.parameters()), 'rows': rows},
                      open(path, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
            ctx = sorted(r['contextMs'] for r in rows)
            print(f"{name:9} {mode:8} {sum(r['correct'] for r in rows)}/{len(rows)}  median context {ctx[len(ctx) // 2]:.0f} ms", flush=True)


main()
