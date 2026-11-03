import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# The platform injects a different flag per team. Never hard-code a real flag.
FLAG = os.environ.get("FLAG", "CTF{local_test_flag}")


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"Hello from the challenge template.")

    def log_message(self, *args):
        pass


ThreadingHTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
