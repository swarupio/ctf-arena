import base64
import os
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

FLAG = os.environ.get("FLAG", "CTF{local_test_flag}")


def role_from(headers):
    cookie = SimpleCookie(headers.get("Cookie", ""))
    if "role" not in cookie:
        return None
    try:
        return base64.b64decode(cookie["role"].value).decode()
    except Exception:
        return ""


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, body, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", "text/html")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body.encode())

    def do_GET(self):
        path = self.path.split("?")[0].rstrip("/") or "/"
        role = role_from(self.headers)
        if path == "/":
            cookie = {} if role is not None else {"Set-Cookie": "role=Z3Vlc3Q=; Path=/"}
            self._send(
                200,
                "<h1>Cookie Jar</h1><p>Welcome, guest. Only admins may visit <a href='/admin'>/admin</a>.</p>",
                cookie,
            )
        elif path == "/admin":
            if role == "admin":
                self._send(200, f"<h1>Admin</h1><p>{FLAG}</p>")
            else:
                self._send(403, "<h1>Forbidden</h1><p>Admins only.</p>")
        else:
            self._send(404, "Not found")

    def log_message(self, *args):
        pass


ThreadingHTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
