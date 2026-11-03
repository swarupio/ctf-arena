// k6 Load Test Script for Mini CTF Arena (P3-07)
// Usage: k6 run deploy/loadtest/k6-loadtest.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const replicasDistribution = new Counter('replicas_distribution');
const apiLatency = new Trend('api_latency');

export const options = {
  stages: [
    { duration: '15s', target: 20 },  // Ramp up to 20 users
    { duration: '30s', target: 50 },  // Maintain 50 users
    { duration: '15s', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<250'], // 95% of requests should be below 250ms
    http_req_failed: ['rate<0.01'],    // HTTP errors should be less than 1%
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://localhost/api/health';

export default function () {
  const res = http.get(BASE_URL);

  check(res, {
    'status is 200': (r) => r.status === 200,
    'has X-Served-By header': (r) => r.headers['X-Served-By'] !== undefined,
  });

  const replica = res.headers['X-Served-By'] || 'unknown';
  replicasDistribution.add(1, { replica: replica });
  apiLatency.add(res.timings.duration);

  sleep(0.1);
}

