#!/usr/bin/env bash
# Mini CTF Arena - build and (re)start the whole stack on the VM (task P3-10).
# Used by the first manual deploy (docs/AZURE_SETUP.md) and by the GitHub Actions deploy job.
#
#   bash deploy/deploy.sh
#   SEED_CHALLENGES=1 bash deploy/deploy.sh      # also register challenges in MongoDB (first deploy)
#   REPLICAS=5 bash deploy/deploy.sh             # scale the backend (default: 3 from docker-compose.yml)
#
# It does NOT run "git pull". The caller pulls first, so this file is never replaced while bash is
# still reading it.
#
# Steps:
#   1. build the frontend into frontend/dist inside a Node 20 container (no Node needed on the VM)
#   2. build one image ctf/<slug> per challenges/<slug>/Dockerfile (unchanged ones are cache hits)
#   3. optionally register challenges/*/challenge.json in MongoDB
#   4. docker compose up -d --build
#   5. recreate Nginx if nginx.conf changed (see the note there)
#   6. wait until http://127.0.0.1:<port>/api/health says ok; exit 1 if it never does
#
# Optional environment: SEED_CHALLENGES, REPLICAS, HEALTH_RETRIES (default 30, 5 s apart), NGINX_HOST_PORT.
# The .env file is only checked for existence; its values are never printed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() { printf '\n==> %s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[ -f .env ] || fail ".env not found in $ROOT. Create it from .env.example first (docs/AZURE_SETUP.md step 7)."
docker info >/dev/null 2>&1 || fail "Cannot talk to Docker. Is it running, and is this user in the docker group (log out and in again)?"

# --- 1. frontend ----------------------------------------------------------------------------
# Vite reads the VITE_* values from /repo/.env (envDir is '..'); they are public build-time values.
# The container runs as the calling user so the files in frontend/ stay owned by you.
log "Building the frontend"
docker run --rm --user "$(id -u):$(id -g)" \
  -e HOME=/tmp -e npm_config_cache=/tmp/.npm \
  -v "$ROOT:/repo" -w /repo/frontend \
  node:20-alpine sh -c 'npm ci --no-audit --no-fund && npm run build'

# --- 2. challenge images --------------------------------------------------------------------
log "Building challenge images"
built=0
for dir in challenges/*/; do
  slug="$(basename "$dir")"
  case "$slug" in _*) continue ;; esac
  [ -f "${dir}Dockerfile" ] || continue   # static challenges have no image
  docker build --quiet -t "ctf/$slug" "$dir" >/dev/null
  echo "ctf/$slug"
  built=$((built + 1))
done
echo "$built challenge image(s) up to date"

# --- 3. register challenges (optional) -------------------------------------------------------
# Runs the same script as "npm run seed:challenges" (backend/package.json) inside the backend image with
# the challenge files mounted at /challenges, which is where the script looks for them in the image.
# It is repeatable: existing challenges are updated in place and keep their solve counts.
if [ "${SEED_CHALLENGES:-0}" = "1" ]; then
  log "Registering challenges in MongoDB"
  docker compose build backend
  docker compose run --rm --no-deps \
    -v "$ROOT/challenges:/challenges:ro" \
    backend node src/scripts/seedChallenges.js
fi

# --- 4. stack ---------------------------------------------------------------------------------
log "Starting the stack"
scale_args=()
if [ -n "${REPLICAS:-}" ]; then
  scale_args=(--scale "backend=${REPLICAS}")
fi
docker compose up -d --build "${scale_args[@]}"

# --- 5. nginx config --------------------------------------------------------------------------
# nginx.conf is bind-mounted as a single file. When git replaces it, the running container keeps
# seeing the old file (it is bound to the old inode), and "up -d" sees no change in the service.
# So compare the file Nginx is really using with the one on disk and recreate Nginx if they differ.
log "Checking the Nginx config"
want="$(sha256sum nginx/nginx.conf | cut -d' ' -f1)"
have="$(docker compose exec -T nginx sha256sum /etc/nginx/nginx.conf 2>/dev/null | cut -d' ' -f1 || true)"
if [ "$want" != "$have" ]; then
  echo "nginx.conf changed: recreating the nginx container"
  docker compose up -d --force-recreate --no-deps nginx
else
  echo "nginx.conf unchanged"
fi

# --- 6. health check -------------------------------------------------------------------------
port="${NGINX_HOST_PORT:-}"
if [ -z "$port" ]; then
  port="$(sed -n 's/^NGINX_HOST_PORT=//p' .env | tail -n 1 | tr -d '\r "')"
fi
url="http://127.0.0.1:${port:-80}/api/health"
retries="${HEALTH_RETRIES:-30}"
log "Waiting for $url"
ok=0
for attempt in $(seq 1 "$retries"); do
  body="$(curl -fsS --max-time 5 "$url" 2>/dev/null || true)"
  case "$body" in
    *'"status":"ok"'*) ok=1; echo "Healthy after attempt $attempt: $body"; break ;;
  esac
  echo "Attempt $attempt/$retries: not ready yet"
  sleep 5
done

if [ "$ok" -ne 1 ]; then
  echo "Health check failed. Container state and recent backend logs:" >&2
  docker compose ps >&2 || true
  docker compose logs --tail=20 backend >&2 || true
  exit 1
fi

docker image prune -f >/dev/null   # drop dangling images left by rebuilds
docker compose ps
log "Deploy finished"
