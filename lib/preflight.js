// lib/preflight.js
// Check that k6 is installed and the target host is reachable.

'use strict';

const { execSync, spawnSync } = require('child_process');
const http = require('http');
const https = require('https');
const { URL } = require('url');

/**
 * Check if k6 is installed and return its version string.
 * Returns { ok: true, version } or { ok: false, error, hint }
 */
function checkK6() {
  try {
    const result = spawnSync('k6', ['version'], { encoding: 'utf8' });
    if (result.status === 0) {
      const version = (result.stdout || '').trim().split('\n')[0];
      return { ok: true, version };
    }
    throw new Error(result.stderr || 'non-zero exit');
  } catch {
    return {
      ok: false,
      error: 'k6_missing',
      hint: 'Install k6: brew install k6 | choco install k6 | apt install k6 | docker run grafana/k6',
    };
  }
}

/**
 * Perform a warm-up GET to baseUrl.
 * Returns { ok: true } or { ok: false, error, hint }
 */
function checkTarget(baseUrl) {
  return new Promise(resolve => {
    let parsed;
    try { parsed = new URL(baseUrl); } catch {
      return resolve({ ok: false, error: 'target_not_reachable', hint: `Invalid URL: ${baseUrl}` });
    }

    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.get(baseUrl, { timeout: 3000 }, res => {
      res.resume();
      resolve({ ok: true, statusCode: res.statusCode });
    });
    req.on('error', () => {
      resolve({
        ok: false,
        error: 'target_not_reachable',
        hint: 'Start the API first (npm run demo:up)',
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({
        ok: false,
        error: 'target_not_reachable',
        hint: 'Connection timed out. Start the API first (npm run demo:up)',
      });
    });
  });
}

module.exports = { checkK6, checkTarget };
