// Shared setup for the harness scripts, so they run unchanged on Windows, macOS and Linux (and on the CI runner).
//   CHROME         path of the Chrome or Chromium binary (default: the first one found in the usual places)
//   PERF_TOOLS     folder whose node_modules has puppeteer-core, lighthouse and axe-core (install outside the repo)
//   PUPPETEER_CORE path or module name of puppeteer-core (legacy: PPTR); default: PERF_TOOLS, then a normal require
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

function chromePath() {
  if (process.env.CHROME) { return process.env.CHROME; }
  const found = CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!found) { throw new Error('No Chrome found. Set CHROME=<path to chrome or chromium>.'); }
  return found;
}

// require() that resolves from PERF_TOOLS/node_modules first, then from the normal module paths.
function toolsRequire() {
  return createRequire(path.resolve(process.env.PERF_TOOLS || '.', 'package.json'));
}

function loadPuppeteer() {
  const explicit = process.env.PUPPETEER_CORE || process.env.PPTR;
  if (explicit) { return require(explicit); }
  try { return toolsRequire()('puppeteer-core'); } catch { return require('puppeteer-core'); }
}

// Flags that keep headless Chrome stable in containers and on CI (small /dev/shm, no sandbox user namespace).
const CHROME_ARGS = ['--no-sandbox', '--disable-dev-shm-usage'];

function launchBrowser(puppeteer = loadPuppeteer()) {
  return puppeteer.launch({ executablePath: chromePath(), headless: 'new', args: CHROME_ARGS });
}

module.exports = { chromePath, toolsRequire, loadPuppeteer, launchBrowser, CHROME_ARGS };
