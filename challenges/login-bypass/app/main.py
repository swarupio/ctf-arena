import os
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs

FLAG = os.environ.get("FLAG", "CTF{local_test_flag}")

CSS = """:root{--ink:#0b0b0b;--paper:#f4f4ef;--lime:#b6f23a;--red:#c1121f}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--ink);
background-color:var(--paper);background-image:radial-gradient(#cfcfc6 1px,transparent 1px);background-size:18px 18px;
display:flex;flex-direction:column}
header{background:var(--ink);color:var(--paper);padding:14px 28px;display:flex;justify-content:space-between;align-items:center;letter-spacing:.08em}
header b{color:var(--lime)}
main{flex:1;display:flex;align-items:center;justify-content:center;padding:32px 16px}
.card{background:#fff;border:2px solid var(--ink);box-shadow:8px 8px 0 var(--ink);max-width:560px;width:100%;padding:32px}
h1{margin:0 0 12px;font-size:2rem;text-transform:uppercase;letter-spacing:.04em}
p{line-height:1.6}
a,.btn,button{display:inline-block;background:var(--ink);color:var(--paper);border:2px solid var(--ink);padding:10px 18px;font:inherit;font-weight:700;text-decoration:none;cursor:pointer}
a:hover,button:hover{background:var(--lime);color:var(--ink)}
input{width:100%;padding:10px;margin:6px 0 14px;border:2px solid var(--ink);font:inherit;background:#fff}
.flag{background:var(--lime);border:2px solid var(--ink);padding:14px;font-weight:700;word-break:break-all;margin-top:16px}
.err{background:#fde8ea;border-left:6px solid var(--red);padding:10px 14px;color:var(--red)}
.muted{color:#555;font-size:.85rem}
footer{padding:12px 28px;font-size:.8rem;color:#555}"""


def page(title, body, brand="CTF Arena challenge"):
    return (
        "<!doctype html><html lang='en'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        f"<title>{title}</title><style>{CSS}</style></head><body>"
        f"<header><span><b>&#9632;</b> {brand}</span><span>private instance</span></header>"
        f"<main><div class='card'>{body}</div></main>"
        "<footer>Practice target. Everything here is intentionally breakable.</footer></body></html>"
    )

# In-memory toy database: this vulnerability only affects this container.
db = sqlite3.connect(":memory:", check_same_thread=False)
db.execute("CREATE TABLE users (username TEXT, password TEXT)")
db.execute("INSERT INTO users VALUES ('admin', ?)", (os.urandom(16).hex(),))
db.commit()

FORM = """<h1>Staff login</h1><form method="post"><label>Username</label><input name="username" placeholder="username" autocomplete="off"><label>Password</label><input name="password" type="password" placeholder="password"><button>Login</button></form>{message}"""


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(body.encode())

    def do_GET(self):
        self._send(200, page("Staff login", FORM.format(message=""), "Staff Portal"))

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
            self._send(200, page("Dashboard", f"<h1>Dashboard</h1><p>Welcome, {row[0]}.</p><div class='flag'>{FLAG}</div>", "Staff Portal"))
        else:
            self._send(401, page("Staff login", FORM.format(message="<div class='err'>Invalid credentials.</div>"), "Staff Portal"))

    def log_message(self, *args):
        pass


ThreadingHTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
