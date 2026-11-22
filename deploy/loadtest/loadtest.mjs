// Mini CTF Arena load test (P3-07/P3-08, extended for docs/LOADTEST.md). Free: only needs Node 20+ and the autocannon dev
// dependency installed in this folder. Prints requests/sec, p50/p95/p99 latency, the status-code mix, the replicas that
// answered (X-Served-By), and a ready-to-paste Markdown table row.
//
//   npm install
//   npm run loadtest -- --label 3                       # API health through Nginx
//   npm run loadtest -- --label static --url http://localhost/
//
// Options (all optional):
//   --url          target (default http://localhost/api/health, or $LOADTEST_URL)
//   --connections  concurrent connections (default 50)
//   --duration     measured seconds (default 20)
//   --warmup       discarded warm-up seconds (default 3)
//   --label        text for the first column of the table row, e.g. the replica count
//   --json         also write the raw numbers to this file
//   --timeline     also write one row per second (status mix, X-Served-By mix, connection errors) to this file (JSON);
//                  use it to see how long an outage lasts when a replica is killed during the run
//   --no-probe     skip the 40-request replica probe (use when the stack is being disturbed on purpose)
//
// Status codes are reported separately: 2xx are successes, 429 is the Nginx per-IP limiter doing its job (NOT a failure,
// not counted in the error rate), every other non-2xx response and every connection error is a failure.
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import autocannon from 'autocannon';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: process.env.LOADTEST_URL ?? 'http://localhost/api/health' },
    connections: { type: 'string', default: '50' },
    duration: { type: 'string', default: '20' },
    warmup: { type: 'string', default: '3' },
    label: { type: 'string', default: '?' },
    json: { type: 'string' },
    timeline: { type: 'string' },
    'no-probe': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  process.stdout.write('Usage: npm run loadtest -- [--url URL] [--connections 50] [--duration 20] [--warmup 3] [--label 3] [--json out.json] [--timeline t.json] [--no-probe]\n');
  process.exit(0);
}

const url = values.url;
const connections = Number.parseInt(values.connections, 10);
const duration = Number.parseInt(values.duration, 10);
const warmup = Number.parseInt(values.warmup, 10);
if (![connections, duration, warmup].every(Number.isInteger) || connections < 1 || duration < 1 || warmup < 0) {
  process.stderr.write('--connections and --duration must be positive integers, --warmup a non-negative integer.\n');
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// Sequential, paced probe: which replicas answer? (X-Served-By is the backend container hostname.)
// Paced below the Nginx per-IP API limit (20 r/s) so it also works from a remote machine.
async function probeReplicas(count = 40) {
  const seen = new Map();
  for (let i = 0; i < count; i += 1) {
    try {
      const res = await fetch(url);
      const replica = res.headers.get('x-served-by') ?? '(none: static or no header)';
      seen.set(replica, (seen.get(replica) ?? 0) + 1);
      await res.arrayBuffer();
    } catch {
      process.stderr.write(`Cannot reach ${url}. Is the stack up (docker compose up -d)?\n`);
      process.exit(1);
    }
    await sleep(60);
  }
  return seen;
}

function percentile(sortedAscending, p) {
  if (sortedAscending.length === 0) { return 0; }
  const index = Math.min(sortedAscending.length - 1, Math.ceil((p / 100) * sortedAscending.length) - 1);
  return sortedAscending[Math.max(0, index)];
}

async function run(seconds, collect) {
  const latencies = [];
  const servedBy = new Map();
  const buckets = []; // one row per elapsed second
  const started = Date.now();
  const bucket = () => {
    const second = Math.floor((Date.now() - started) / 1000);
    while (buckets.length <= second) {
      buckets.push({ second: buckets.length, ok: 0, limited: 0, failed: 0, connErrors: 0, servedBy: {} });
    }
    return buckets[second];
  };
  const requests = [{
    method: 'GET',
    onResponse(status, _body, _context, headers) {
      if (!collect) { return; }
      const row = bucket();
      if (status >= 200 && status < 300) { row.ok += 1; } else if (status === 429) { row.limited += 1; } else { row.failed += 1; }
      const replica = headers?.['X-Served-By'] ?? headers?.['x-served-by']; // autocannon keeps the header name as sent
      if (replica) {
        servedBy.set(replica, (servedBy.get(replica) ?? 0) + 1);
        row.servedBy[replica] = (row.servedBy[replica] ?? 0) + 1;
      }
    },
  }];
  const instance = autocannon({ url, connections, duration: seconds, pipelining: 1, timeout: 10, requests });
  if (collect) {
    instance.on('response', (_client, _status, _bytes, responseTime) => { latencies.push(responseTime); });
    instance.on('reqError', () => { bucket().connErrors += 1; });
  }
  const result = await instance;
  return { result, latencies, servedBy, buckets };
}

const fmt = (n, digits = 1) => Number(n).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });

process.stdout.write(`Target: ${url}\nConnections: ${connections}, warm-up ${warmup}s, measured ${duration}s\n\n`);

const replicas = values['no-probe'] ? new Map() : await probeReplicas();
const replicaList = [...replicas.entries()].sort((a, b) => b[1] - a[1]);
if (!values['no-probe']) {
  process.stdout.write(`Replicas that answered 40 probe requests: ${replicas.size}\n`);
  for (const [name, hits] of replicaList) {
    process.stdout.write(`  ${name}  x${hits}\n`);
  }
  process.stdout.write('\n');
}

if (warmup > 0) {
  process.stdout.write('Warming up...\n');
  await run(warmup, false);
}
process.stdout.write('Measuring...\n');
const { result, latencies, servedBy, buckets } = await run(duration, true);

latencies.sort((a, b) => a - b);
const statusCounts = {};
for (const [code, stat] of Object.entries(result.statusCodeStats ?? {})) { statusCounts[code] = stat.count; }
const responses = result.requests.total;
const ok2xx = result['2xx'] ?? 0;
const limited429 = statusCounts['429'] ?? 0;
const otherNon2xx = Math.max(0, result.non2xx - limited429);
const failed = result.errors + otherNon2xx; // 429 is the limiter working, not a failure
const attempts = responses + result.errors;
const errorRate = attempts === 0 ? 0 : (failed / attempts) * 100;
const rps = responses / result.duration;
const p50 = percentile(latencies, 50);
const p95 = percentile(latencies, 95);
const p99 = percentile(latencies, 99);
const max = latencies.length > 0 ? latencies[latencies.length - 1] : 0;

process.stdout.write(`
Requests:      ${responses.toLocaleString('en-US')} in ${fmt(result.duration)}s
Requests/sec:  ${fmt(rps, 0)}
Latency (ms):  p50 ${fmt(p50)}   p95 ${fmt(p95)}   p99 ${fmt(p99)}   max ${fmt(max)}
Status mix:    ${ok2xx} 2xx, ${limited429} x 429 (Nginx limiter, not a failure), ${otherNon2xx} other non-2xx, ${result.errors} connection errors
Failures:      ${failed} -> error rate ${fmt(errorRate, 2)} % (429 excluded)
`);
if (otherNon2xx > 0 || limited429 > 0) {
  const codes = Object.entries(statusCounts).map(([code, count]) => `${code}: ${count}`).join(', ');
  process.stdout.write(`Status codes:  ${codes}\n`);
  if (limited429 > 0) {
    process.stdout.write('Note: 429 means the Nginx per-IP rate limit engaged. Run the test from the host itself (loopback and Docker ranges are exempt).\n');
  }
}
const servedList = [...servedBy.entries()].sort((a, b) => b[1] - a[1]);
if (servedList.length > 0) {
  process.stdout.write(`X-Served-By during the run: ${servedList.map(([name, hits]) => `${name}=${hits}`).join(', ')}\n`);
}

process.stdout.write(`\n| Replicas | Requests/sec | p95 latency (ms) | p99 latency (ms) | Error rate |\n|----------|--------------|------------------|------------------|------------|\n| ${values.label} | ${fmt(rps, 0)} | ${fmt(p95)} | ${fmt(p99)} | ${fmt(errorRate, 2)} % |\n`);

if (values.json) {
  await writeFile(values.json, `${JSON.stringify({
    url,
    label: values.label,
    connections,
    durationSeconds: result.duration,
    requests: responses,
    requestsPerSecond: rps,
    latencyMs: { p50, p95, p99, max },
    non2xx: result.non2xx,
    statusCodes: statusCounts,
    ok2xx,
    limited429,
    otherNon2xx,
    errors: result.errors,
    errorRatePercent: errorRate,
    replicasSeen: Object.fromEntries(replicas),
    servedByDuringRun: Object.fromEntries(servedBy),
  }, null, 2)}\n`);
}
if (values.timeline) {
  await writeFile(values.timeline, `${JSON.stringify({ url, connections, rows: buckets }, null, 2)}\n`);
}
