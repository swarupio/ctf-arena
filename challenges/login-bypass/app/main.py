import os
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs

FLAG = os.environ.get("FLAG", "CTF{local_test_flag}")

# In-memory toy database: this vulnerability only affects this container.
db = sqlite3.connect(":memory:", check_same_thread=False)
db.execute("CREATE TABLE users (username TEXT, password TEXT)")
db.execute("INSERT INTO users VALUES ('admin', ?)", (os.urandom(16).hex(),))
db.commit()

FORM = """<h1>Staff login</h1><form method="post">
<input name="username" placeholder="username"><input name="password" type="password" placeholder="password">
<button>Login</button></form><p>{message}</p>"""


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(body.encode())

    def do_GET(self):
        self._send(200, FORM.format(message=""))

    def do_POST(self):
        length = min(int(self.headers.get("Content-Length", 0)), 1024)
        data = parse_qs(self.rfile.read(length).decode())
        username = data.get("username", [""])[0]
        password = data.get("password", [""])[0]
        # Intentionally vulnerable: string concatenation.
        query = (
            "SELECT username FROM users WHERE username = '" + username
            + "' AND password = '" + password + "'"
        )
        try:
            row = db.execute(query).fetchone()
        except sqlite3.Error:
            row = None
        if row:
            self._send(200, f"<h1>Dashboard</h1><p>Welcome, {row[0]}. {FLAG}</p>")
        else:
            self._send(401, FORM.format(message="Invalid credentials."))

    def log_message(self, *args):
        pass


ThreadingHTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
