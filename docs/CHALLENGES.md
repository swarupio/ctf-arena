# Challenges Guide (owner: Gururaj)

## 1. Two kinds of challenge

| Type | How it works | Example |
|------|--------------|---------|
| `static` | No container. Flag is in a downloadable file or in the description. Backend compares the submission to a stored salted hash. | Caesar cipher, hidden image data |
| `docker` | Each team gets its own container. Flag is injected as the env variable `FLAG` and is **different for every team**, which stops flag sharing. | Cookie tampering, SQL injection |

## 2. Container rules (every Docker challenge must follow)
1. Reads the flag from the `FLAG` environment variable. **Never** hard-code a flag in the image.
2. Listens on **one** port. That value goes into `internalPort`.
3. Runs as a **non-root** user.
4. Small base image (`alpine` or `python:3.12-slim`, `node:20-alpine`).
5. No outbound network needed. Must work with a read-only root filesystem if possible (write only to `/tmp`).
6. Starts in under 5 seconds and uses under 128 MB RAM.
7. Has a `README.md` inside its folder with: intended solution, flag location, and a hint ladder (never shown to players).
8. Image name is `ctf/<slug>`.

## 3. Folder template (`challenges/_template/`)
```
challenges/_template/
├── Dockerfile
├── app/            # the vulnerable app
└── README.md       # solution notes (admin only)
```

**Example Dockerfile (Python/Flask style)**
```dockerfile
FROM python:3.12-slim
RUN useradd -m -u 10001 ctf
WORKDIR /app
COPY app/ /app/
RUN pip install --no-cache-dir flask
USER ctf
EXPOSE 8000
CMD ["python", "main.py"]
```

**How the app reads the flag**
```python
import os
FLAG = os.environ.get("FLAG", "CTF{local_test_flag}")
```

**Local test**
```bash
docker build -t ctf/cookie-monster challenges/cookie-monster
docker run --rm -e FLAG=CTF{test} -p 8080:8000 --memory 128m --cpus 0.25 ctf/cookie-monster
```

## 4. Starter challenge set (build at least the ones marked MVP)

| # | Slug | Title | Category | Type | Points | MVP |
|---|------|-------|----------|------|--------|-----|
| 1 | `sanity-check` | Sanity Check | misc | static | 25 | Yes |
| 2 | `caesar-says` | Caesar Says | crypto | static | 75 | Yes |
| 3 | `robots-rule` | Robots Rule | web | docker | 100 | Yes |
| 4 | `cookie-monster` | Cookie Monster | web | docker | 100 | Yes |
| 5 | `hidden-in-plain-sight` | Hidden in Plain Sight | forensics | static | 150 | Optional |
| 6 | `login-bypass` | Login Bypass | web | docker | 200 | Optional |
| 7 | `netcat-oracle` | Netcat Oracle | misc | docker | 250 | Stretch |

### 1. Sanity Check (static, 25)
- Description tells players the flag format and includes the flag `CTF{welcome_to_the_arena}`.
- Purpose: lets every team test submission and see the leaderboard move.

### 2. Caesar Says (static, 75)
- Attachment: `cipher.txt` with a Caesar-shifted sentence containing the flag.
- Solution: try all 26 shifts (online tool or a 5-line script).

### 3. Robots Rule (docker, 100)
- Simple site. `robots.txt` lists `/internal-admin-panel`. That page prints `FLAG`.
- Teaches: reconnaissance basics.

### 4. Cookie Monster (docker, 100)
- Site sets a cookie `role=Z3Vlc3Q=` (base64 of `guest`). The `/admin` page needs `admin`, which is `YWRtaW4=`.
- Solution: edit the cookie in browser dev tools.

### 5. Hidden in Plain Sight (static, 150)
- Attachment: a PNG with the flag appended after the image data or in metadata.
- Solution: `strings image.png | grep CTF` or `exiftool`.

### 6. Login Bypass (docker, 200)
- Flask + SQLite login built with string concatenation. Classic `' OR 1=1 --` bypass; the dashboard prints `FLAG`.
- Make sure the vulnerable code is inside the container only; no real database is touched.

### 7. Netcat Oracle (docker, 250, stretch)
- TCP service on the internal port. Asks a few maths questions quickly; after 10 correct answers it prints `FLAG`.
- Solution: a short script with sockets.

## 5. Flag formats
- Docker challenges: `CTF{<slug_with_underscores>_<12 hex chars>}` generated per team by `flagService` (HMAC, see ARCHITECTURE 3.3).
- Static challenges: any readable text in the format `CTF{...}`.

## 6. Adding a challenge to the platform
1. Build and test the image locally.
2. Admin creates it through `POST /api/admin/challenges` (or the admin form).
3. For docker type, set `image` and `internalPort`; leave `flag` empty.
4. Start an instance as a test team, solve it, submit the flag, check the score.
5. Commit the folder and mention it in the handoff note.

## 7. Safety rules for challenge authors
- Vulnerabilities must only affect the challenge's own toy app.
- No real credentials, no calls to the internet, no shell access into the host.
- Do not include any real person's data in challenge content.
