# Challenge template (copy this folder to `challenges/<slug>/`)

Rules (see `docs/CHALLENGES.md` section 2):
1. Read the flag from the `FLAG` environment variable. Never hard-code it.
2. Listen on **one** port (here 8000) and put it in `internalPort`.
3. Run as a non-root user and write only to `/tmp` (the container root is read-only).
4. Small base image, starts in under 5 seconds, under 128 MB RAM.
5. Image name is `ctf/<slug>`.

## Solution notes (admin only)
- Intended solution:
- Flag location:
- Hint ladder:

## Build and test locally
```bash
docker build -t ctf/<slug> challenges/<slug>
docker run --rm -e FLAG=CTF{test} -p 8080:8000 --memory 128m --cpus 0.25 --read-only --tmpfs /tmp ctf/<slug>
```

Add a `challenge.json` (see the starter challenges), then run `npm run seed:challenges` in `backend/`.
