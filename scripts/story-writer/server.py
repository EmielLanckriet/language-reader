#!/usr/bin/env python3
"""The laptop's story writer for Reader (spec 016, contracts/service.md): better and faster than
the phone's model, used by the phone's reader service whenever it answers.

    python server.py --model ~/…/Qwen3-4B-Instruct-2507-Q4_K_M.gguf [--host 127.0.0.1] [--port 8766]

Run it with the Python that has llama_cpp (sentencegen's venv). Over USB the phone reaches it after
`adb reverse tcp:8766 tcp:8766`; on Wi-Fi, start it with --host 0.0.0.0 and save
{"url": "http://<laptop address>:8766"} as ~/.reader/laptop.json in Termux.
"""
import argparse
import http.server
import json
import re
import threading
import time

from llama_cpp import Llama


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8766)
    parser.add_argument('--threads', type=int, default=4)
    args = parser.parse_args()
    llm = Llama(model_path=args.model, n_ctx=8192, n_threads=args.threads, verbose=False)
    one_at_a_time = threading.Lock()

    class Handler(http.server.BaseHTTPRequestHandler):
        def reply(self, status, body):
            data = json.dumps(body, ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *args):
            pass

        def do_GET(self):
            if self.path == '/health':
                return self.reply(200, {'writer': 'laptop'})
            self.reply(404, {})

        def do_POST(self):
            if self.path != '/generate':
                return self.reply(404, {})
            body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))
            started = time.monotonic()
            with one_at_a_time:
                out = llm.create_chat_completion(messages=body['messages'],
                                                 temperature=float(body.get('temperature', 0.7)),
                                                 top_p=0.8, max_tokens=int(body.get('max_tokens', 700)))
            text = re.sub(r'<think>.*?</think>', '', out['choices'][0]['message']['content'], flags=re.S)
            print(f'story in {time.monotonic() - started:.0f} s', flush=True)
            self.reply(200, {'text': text.strip()})

    print(f'story writer on {args.host}:{args.port}', flush=True)
    http.server.ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == '__main__':
    main()
