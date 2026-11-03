# Load test and scale demo (P3-07, P3-08)

A free load test: one small Node script on top of [autocannon](https://github.com/mcollina/autocannon).
It lives only in this folder (own `package.json`), so `backend/` and `frontend/` are untouched.

It hits `GET /api/health` through Nginx (no login needed; the request goes through the full proxy to a backend
replica, which reports its database connection state), first sends 40 paced probe requests to list which replicas answered (`X-Served-By`),
then runs a warm-up and a measured run, and prints requests/second, p50/p95/p99 latency, the error rate and a
Markdown table row to paste into `docs/DEMO_AND_REPORT.md`.

Two more tools from PR #12 live in this folder and do not conflict with the above: `loadtest.js` (zero-dependency
Node script: `node deploy/loadtest/loadtest.js http://localhost/api/health 20 20`) and `k6-loadtest.js`
(`k6 run deploy/loadtest/k6-loadtest.js`, needs k6). The results below were measured with autocannon.

## Run it

Needs Node 20+ and the stack running (`docker compose up -d --build`, frontend built first, see the root README).

```bash
cd deploy/loadtest
npm install                                   # once
npm run loadtest -- --label 3                 # defaults: http://localhost/api/health, 50 connections, 20 s
npm run loadtest -- --label static --url http://localhost/ --duration 10      # the static site
npm run loadtest -- --help
```

If Nginx is on another host port (`NGINX_HOST_PORT=8080`), pass `--url http://localhost:8080/api/health`.

**Run it from the machine that hosts the stack** (on the Azure VM: over SSH, against `localhost`). Nginx limits each
client IP to 20 requests/second on `/api` and answers 429 above that; loopback and Docker-bridge addresses are
exempt, so a local run measures the replicas. Running it from another computer against the public IP correctly
hits the limiter and shows 429s (the script prints a note). On a small shared VM, expect the load generator itself
to use CPU, so numbers are a lower bound.

## Measure 1, 3 and 5 replicas (P3-07)

```bash
docker compose up -d --scale backend=1     # then wait ~15 s: Nginx refreshes the replica list every 10 s
npm run loadtest -- --label 1 --json result-1.json

docker compose up -d --scale backend=3
npm run loadtest -- --label 3 --json result-3.json

docker compose up -d --scale backend=5
npm run loadtest -- --label 5 --json result-5.json
```

Check `Replicas that answered` in the output: it must list as many different container names as you scaled to.
Do not run other heavy programs at the same time, and repeat each run twice; take the better, stable one.

## Scale demo (P3-08)

`docker compose up -d --scale backend=5` works with no code or config change: the backend is stateless (all state is
in MongoDB), Nginx finds replicas through Docker DNS (`resolver 127.0.0.11 valid=10s` plus a variable in
`proxy_pass`), and the 5 replicas start without port clashes because they publish no ports. To see it live:

```bash
docker compose up -d --scale backend=5
docker compose ps                                                  # 5 healthy backends
for i in $(seq 1 12); do curl -sI http://localhost/api/health | grep -i x-served-by; done
```

PowerShell: `1..12 | % { (Invoke-WebRequest http://localhost/api/health).Headers['X-Served-By'] }`.
In the browser the footer shows `Served by <replica>` and changes as you navigate. Scale back with `--scale backend=3`.
New replicas are used after at most 10 seconds (Nginx's DNS cache); removed replicas are skipped by Nginx's retry
(`proxy_next_upstream`) until then.

## Results

**Machine: a developer laptop, not the Azure VM.** Intel Core i5-13420H (8 cores / 12 threads), 15.7 GB RAM,
Windows 11, Docker Desktop 29.7.2 (Linux engine, 12 CPUs / 7.6 GB given to Docker), Node 24 for the load generator.
Measured 2026-11-03/04 with other containers and apps running, so treat the numbers as indicative. The Azure
`Standard_B2s` (2 vCPUs) will give different absolute figures; re-run the same commands there and fill in the
second table.

Test: `GET /api/health` through Nginx (`NGINX_HOST_PORT=8088`), 50 connections, 20 s measured after a 3 s warm-up,
the load generator running on the same machine as the stack. Each configuration was run twice.

| Replicas | Run | Requests/sec | p95 latency (ms) | p99 latency (ms) | Error rate |
|----------|-----|--------------|------------------|------------------|------------|
| 1 | 1 | 2,134 | 37.8 | 49.1 | 0.00 % |
| 1 | 2 | 1,652 | 49.9 | 62.1 | 0.00 % |
| 3 | 1 | 3,184 | 46.3 | 64.9 | 0.04 % |
| 3 | 2 | 2,847 | 44.0 | 60.3 | 0.04 % |
| 5 | 1 | 3,562 | 44.5 | 68.5 | 0.07 % |
| 5 | 2 | 3,689 | 46.3 | 63.6 | 0.05 % |

Mean of the two runs (the table for the report):

| Replicas | Requests/sec | p95 latency (ms) | p99 latency (ms) | Error rate |
|----------|--------------|------------------|------------------|------------|
| 1 | 1,893 | 43.9 | 55.6 | 0.00 % |
| 3 | 3,016 | 45.2 | 62.6 | 0.04 % |
| 5 | 3,626 | 45.4 | 66.1 | 0.06 % |

Static site (`/`, no backend involved), single run: 1,758 / 2,172 / 1,567 requests/s at 1 / 3 / 5 replicas
(unchanged by the replica count, as expected; the differences are noise).

How to read it:

- **Throughput scales with replicas but not linearly: about 1.6x at 3 and 1.9x at 5.** With this cheap endpoint
  the test machine runs out of CPU before 5 Node processes do: the single-threaded load generator, Nginx and Docker
  Desktop's network layer all share the same laptop. The latency percentiles stay flat for the same reason (the
  generator keeps 50 connections busy). Do not read "5 replicas = 1.9x faster" as a promise for the VM.
- **Every run had 0 non-2xx responses.** The 0.04-0.07 % "error rate" is autocannon-side connection errors (about
  25-50 out of 60,000-70,000 requests) from the Windows/Docker Desktop network path, not responses from Nginx or the backend.
- The probe step listed 1, 3 and 5 different `X-Served-By` names at 1, 3 and 5 replicas, so the load was really spread.
- **Why Nginx has `sysctls` and `Connection: close` upstream.** The first 1-replica run failed with 24-100 % `502`
  after a few seconds: Nginx opens a new TCP connection per proxied request (keep-alive to upstream is impossible
  with dynamic Docker DNS), and one backend address only has about 28,000 ephemeral ports, all stuck in `TIME_WAIT`
  for 60 s. That is why `docker-compose.yml` widens the port range and enables `tcp_tw_reuse` for the Nginx
  container. With that fix a 60 s run at 1 replica had 0 `502` (and the effect does not show with several
  replicas, because every replica is another set of ports).

Azure VM (fill in after deploying; run from the VM itself, see above):

Machine: Azure ____ (size, vCPU, RAM), Ubuntu ____, Docker ____.

| Replicas | Requests/sec | p95 latency (ms) | p99 latency (ms) | Error rate |
|----------|--------------|------------------|------------------|------------|
| 1 | | | | |
| 3 | | | | |
| 5 | | | | |

## Notes on dependencies

`autocannon` is a dev dependency of this folder only: it is the standard free Node HTTP benchmarking tool, so no paid
service or system install (k6, Apache Bench) is needed. `npm audit` reports a moderate `uuid` advisory in its
dependency tree; it only affects code paths this script does not use and nothing here is deployed.
