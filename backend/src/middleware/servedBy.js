import os from 'node:os';

export function servedBy(req, res, next) {
  res.set('X-Served-By', os.hostname());
  next();
}
