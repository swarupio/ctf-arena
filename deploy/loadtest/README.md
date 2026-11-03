# Load Testing & Scale Demonstration (Task P3-07 & P3-08)

This directory contains benchmark and load testing tools to verify load balancing and scaling across backend replicas in Mini CTF Arena.

## Tools Provided

1. **`loadtest.js`**: Zero-dependency native Node.js load tester.
2. **`k6-loadtest.js`**: k6 load test script.

---

## Instructions for Replicas Benchmark (1, 3, and 5 Replicas)

To fill out the table in `docs/DEMO_AND_REPORT.md`, run the benchmark under each replica configuration:

### Step 1: Benchmark 1 Replica
```bash
docker compose up -d --scale backend=1
# Wait 5 seconds for Nginx DNS resolver
node deploy/loadtest/loadtest.js http://localhost/api/health 20 20
```

### Step 2: Benchmark 3 Replicas
```bash
docker compose up -d --scale backend=3
# Wait 5 seconds for Nginx DNS resolver
node deploy/loadtest/loadtest.js http://localhost/api/health 20 20
```

### Step 3: Benchmark 5 Replicas
```bash
docker compose up -d --scale backend=5
# Wait 5 seconds for Nginx DNS resolver
node deploy/loadtest/loadtest.js http://localhost/api/health 20 20
```

---

## Results Table to Complete for Demo & Report

| Replicas | Requests/sec | p95 latency (ms) | Error rate |
|----------|--------------|------------------|------------|
| 1        |              |                  |            |
| 3        |              |                  |            |
| 5        |              |                  |            |

