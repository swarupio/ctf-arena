# Login Bypass (web, docker, 200)
- **Solution:** SQL injection. Username `admin' --` (or `' OR 1=1 --`) with any password.
- **Flag location:** printed on the dashboard from the `FLAG` env var (different per team).
- **Hints:** 1) The form builds its query from your text. 2) What does a quote do?
- **Safety:** SQLite runs in memory inside the container; no real database is touched.
- **Build:** `docker build -t ctf/login-bypass challenges/login-bypass`
