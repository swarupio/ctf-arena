import os from 'node:os';
import mongoose from 'mongoose';

let pendingRequests = 0;
const hostname = os.hostname();

export function recordRequest() {
  pendingRequests += 1;
}

export async function flushReplicaCount() {
  if (pendingRequests === 0) return;
  const toFlush = pendingRequests;
  pendingRequests = 0;
  try {
    const db = mongoose.connection?.db;
    if (db) {
      await db.collection('replica_stats').updateOne(
        { _id: hostname },
        { $inc: { requests: toFlush } },
        { upsert: true }
      );
    }
  } catch {
    // Re-add on failure
    pendingRequests += toFlush;
  }
}

// Periodic flush every 3 seconds without keeping the event loop alive
const timer = setInterval(flushReplicaCount, 3000);
if (timer.unref) {
  timer.unref();
}

