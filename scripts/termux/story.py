#!/usr/bin/env python3
"""One story draft written on the phone, for Reader's stories (spec 016, contracts/service.md).

    story.py < request.json        # {"messages": [...], "max_tokens": n, "temperature": t}

The reader service runs this when the laptop's writer does not answer. Qwen3-1.7B, the model
translate.py already has, through translate.py's own budget: one model at a time across stories
and translations, waiting while Reader transcribes or memory is short. Thinking is switched off
(/no_think): left on, the 1.7B spent its answer reasoning in English (research R1). Tells the service
on stderr what it waits for ("waiting model", then translate.py's own memory or Reader messages) and
"writing" once it runs; the draft goes to stdout. STORY_STUB=1 answers a fixed story; STORY_STUB=
wait-memory waits for memory for ever, as on a phone short of it.
"""
import contextlib
import importlib.util
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))


def prompt(messages):
    """Qwen's chat format, the last user turn told not to think, the answer's empty think given."""
    turns = []
    for i, message in enumerate(messages):
        last = i == len(messages) - 1
        content = message['content'] + (' /no_think' if last and message['role'] == 'user' else '')
        turns.append(f"<|im_start|>{message['role']}\n{content}<|im_end|>\n")
    return ''.join(turns) + '<|im_start|>assistant\n<think>\n\n</think>\n\n'


def main():
    request = json.load(sys.stdin)
    if os.environ.get('STORY_STUB') == 'wait-memory':
        print('waiting model', file=sys.stderr, flush=True)
        print('waiting for sufficient measurable free memory', file=sys.stderr, flush=True)
        while True:
            time.sleep(1)
    if os.environ.get('STORY_STUB') == '1':
        print('waiting model', file=sys.stderr, flush=True)
        print('writing', file=sys.stderr, flush=True)
        print('今天我和妈妈去市场买菜。妈妈说：“我们买一点青菜吧。”')
        return
    spec = importlib.util.spec_from_file_location('translate', os.path.join(HERE, 'translate.py'))
    translate = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(translate)
    print('waiting model', file=sys.stderr, flush=True)
    # translate.py tells its own waits on stdout, which here carries the story.
    with contextlib.redirect_stdout(sys.stderr), translate.model_budget():
        print('writing', file=sys.stderr, flush=True)
        # -c 4096: the known-word list and two earlier drafts reach about 2,500 tokens. Two threads:
        # the phone's two fast cores; translation uses one to stay out of Reader's way, but here the
        # reader is waiting for the story.
        out = translate.run_model(
            [translate.LLAMA, '-m', translate.MODEL, '-c', '4096', '--no-repack', '-p',
             prompt(request['messages']), '-n', str(int(request.get('max_tokens', 700))),
             '--temp', str(float(request.get('temperature', 0.7))), '-t', '2', '-no-cnv',
             '--no-display-prompt'],
            seconds=900,
        )
    print(out.replace('[end of text]', '').strip())


if __name__ == '__main__':
    main()
