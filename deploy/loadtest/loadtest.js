#!/usr/bin/env node
/**
 * CTF Arena - Replicas Benchmark & Load Test
 * Task P3-07 (Shubham)
 *
 * Runs without external dependencies using native Node.js HTTP/HTTPS client.
 * Evaluates:
 *  - Requests per second (RPS)
 *  - Latency: Min, Mean, p50, p90, p95, Max
 *  - Replica distribution via `X-Served-By` header
 *  - Error rates
 *
 * Usage:
 *   node deploy/loadtest/loadtest.js [targetUrl] [durationSeconds] [concurrency]
 * Example:
 *   node deploy/loadtest/loadtest.js http://localhost/api/health 10 20
 */

import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

const targetUrl = process.argv[2] || 'http://localhost/api/health';
const durationSec = parseInt(process.argv[3] || '10', 10);
const concurrency = parseInt(process.argv[4] || '20', 10);

const parsedUrl = new URL(targetUrl);
const client = parsedUrl.protocol === 'https:' ? https : http;

console.log('====================================================');
console.log('       MINI CTF ARENA - LOAD TEST RUNNER (P3-07)     ');
console.log('====================================================');
console.log(`Target:      ${targetUrl}`);
console.log(`Duration:    ${durationSec}s`);
console.log(`Concurrency: ${concurrency} parallel workers`);
console.log('----------------------------------------------------');

const replicaCounts = new Map();
const latencies = [];
let totalRequests = 0;
let successCount = 0;
let errorCount = 0;

const startTime = Date.now();
const endTime = startTime + durationSec * 1000;
let isRunning = true;

function sendRequest() {
  if (Date.now() >= endTime) {
    return;
  }

  const reqStart = process.hrtime.bigint();
  const req = client.get(targetUrl, {
    agent: new client.Agent({ keepAlive: true, maxSockets: concurrency }),
    timeout: 3000,
  }, (res) => {
    const servedBy = res.headers['x-served-by'] || 'unknown';
    res.resume(); // consume body

    res.on('end', () => {
      const reqEnd = process.hrtime.bigint();
      const latencyMs = Number(reqEnd - reqStart) / 1e6;

      latencies.push(latencyMs);
      totalRequests += 1;

      if (res.statusCode >= 200 && res.statusCode < 400) {
        successCount += 1;
        replicaCounts.set(servedBy, (replicaCounts.get(servedBy) || 0) + 1);
      } else {
        errorCount += 1;
      }

      if (isRunning && Date.now() < endTime) {
        setImmediate(sendRequest);
      }
    });
  });

  req.on('error', () => {
    totalRequests += 1;
    errorCount += 1;
    if (isRunning && Date.now() < endTime) {
      setImmediate(sendRequest);
    }
  });

  req.on('timeout', () => {
    req.destroy();
  });
}

// Start concurrent workers
for (let i = 0; i < concurrency; i += 1) {
  sendRequest();
}

setTimeout(() => {
  isRunning = false;
  printResults();
}, durationSec * 1000 + 1000);

function printResults() {
  const actualDurationSec = (Date.now() - startTime) / 1000;
  latencies.sort((a, b) => a - b);

  const getPercentile = (p) => {
    if (latencies.length === 0) return 0;
    const idx = Math.min(Math.floor((p / 100) * latencies.length), latencies.length - 1);
    return latencies[idx].toFixed(2);
  };

  const avgLatency = latencies.length > 0
    ? (latencies.reduce((acc, curr) => acc + curr, 0) / latencies.length).toFixed(2)
    : 0;
  const rps = (totalRequests / actualDurationSec).toFixed(1);
  const errorRate = totalRequests > 0 ? ((errorCount / totalRequests) * 100).toFixed(2) : 0;

  console.log('\n--- LOAD TEST RESULTS ---');
  console.log(`Total Requests:    ${totalRequests}`);
  console.log(`Successful:        ${successCount}`);
  console.log(`Failed / Errors:   ${errorCount} (${errorRate}%)`);
  console.log(`Actual Duration:   ${actualDurationSec.toFixed(2)}s`);
  console.log(`Throughput:        ${rps} req/sec`);
  console.log('\n--- LATENCY (ms) ---');
  console.log(`Avg Latency:       ${avgLatency} ms`);
  console.log(`p50 (Median):      ${getPercentile(50)} ms`);
  console.log(`p90:               ${getPercentile(90)} ms`);
  console.log(`p95:               ${getPercentile(95)} ms`);
  console.log(`p99:               ${getPercentile(99)} ms`);

  console.log('\n--- REPLICA TRAFFIC DISTRIBUTION (X-Served-By) ---');
  if (replicaCounts.size === 0) {
    console.log('No replicas reported X-Served-By headers.');
  } else {
    for (const [replica, count] of replicaCounts.entries()) {
      const pct = ((count / successCount) * 100).toFixed(1);
      console.log(`  ${replica.padEnd(20)}: ${String(count).padStart(6)} reqs (${pct}%)`);
    }
  }
  console.log('====================================================\n');
}

