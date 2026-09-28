"""Serve the phone pages with cross-origin isolation (threads need it), and collect their results.

    python serve.py <model dir: model.int8.onnx, tokens.txt, meta.json> <audio dir: s0.wav…> <results.jsonl>
    adb reverse tcp:8799 tcp:8799

Pages POST their results to /result, one JSON line each.
"""
import http.server, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROUTES = {'/ort/': os.path.join(HERE, '..', 'node_modules', 'onnxruntime-web', 'dist'),
          '/sensevoice.mjs': os.path.join(HERE, '..', 'sensevoice.mjs'),
          '/resample.mjs': os.path.join(HERE, '..', 'resample.mjs')}
MODEL, AUDIO, RESULTS = sys.argv[1:4]


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.mjs': 'text/javascript', '.wasm': 'application/wasm'}

    def translate_path(self, path):
        path = path.split('?')[0]
        for prefix, target in ROUTES.items():
            if path.startswith(prefix):
                return os.path.join(target, path[len(prefix):]) if prefix.endswith('/') else target
        name = os.path.basename(path)
        if name in ('model.int8.onnx', 'tokens.txt', 'meta.json'): return os.path.join(MODEL, name)
        if name.endswith(('.wav', '.aac', '.f32')): return os.path.join(AUDIO, name)
        return os.path.join(HERE, name)

    def do_POST(self):
        body = self.rfile.read(int(self.headers['Content-Length']))
        with open(RESULTS, 'ab') as f: f.write(body + b'\n')
        self.send_response(204); self.end_headers()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        super().end_headers()

    def log_message(self, *args): pass


http.server.ThreadingHTTPServer(('127.0.0.1', 8799), Handler).serve_forever()
