import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

FLAG = os.environ.get("FLAG", "CTF{local_test_flag}")
INDEX = b"<h1>Acme Intranet</h1><p>Nothing to see here. Move along.</p>"
ROBOTS = b"User-agent: *\nDisallow: /internal-admin-panel\n"


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, body, content_type="text/html"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0].rstrip("/") or "/"
        if path == "/":
            self._send(200, INDEX)
        elif path == "/robots.txt":
            self._send(200, ROBOTS, "text/plain")
        elif path == "/internal-admin-panel":
            self._send(200, f"<h1>Admin panel</h1><p>{FLAG}</p>".encode())
        else:
            self._send(404, b"Not found")

    def log_message(self, *args):
        pass


ThreadingHTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
