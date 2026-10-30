# Local dev server: serves the extension folder and accepts POST /upload (raw recordings).
# Usage: python3 -I dev/tools/dev-server.py <folder-to-serve> <uploads-folder>  (listens on 127.0.0.1:8765)

import http.server, sys, os, time
UPLOADS = sys.argv[2]
class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.js': 'text/javascript'}
    def do_POST(self):
        if self.path != '/upload':
            self.send_error(404); return
        n = int(self.headers.get('Content-Length', 0))
        if n > 50_000_000:
            self.send_error(413); return
        name = os.path.join(UPLOADS, f'raw-{int(time.time())}.json')
        with open(name, 'wb') as f:
            f.write(self.rfile.read(n))
        self.send_response(200); self.end_headers(); self.wfile.write(name.encode())
os.chdir(sys.argv[1])
http.server.ThreadingHTTPServer(('127.0.0.1', 8765), H).serve_forever()
