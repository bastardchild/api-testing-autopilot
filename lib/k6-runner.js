// lib/k6-runner.js
// Execute k6, parse results/summary.json, return compact metrics.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { checkK6, checkTarget } = require('./preflight');
const { URL } = require('url');

const RESULTS_DIR = path.join(process.cwd(), 'results');
const MAX_ERROR_RATE = 0.20;

/**
 * Parse a k6 duration string to seconds.
 */
function parseDuration(s) {
  const m = String(s).match(/^(\d+)(s|m)$/);
  if (!m) return 30;
  return m[2] === 'm' ? Number(m[1]) * 60 : Number(m[1]);
}

/**
 * Validate script content — reject dangerous patterns unless from generator.
 */
function validateScript(content) {
  if (/require\s*\(/.test(content)) return { ok: false, error: 'rejected_script', hint: 'Script contains require() — only scripts from generate_test_script are accepted' };
  if (/import\s*\(/.test(content)) return { ok: false, error: 'rejected_script', hint: 'Script contains dynamic import() — forbidden' };
  if (/\bopen\s*\(/.test(content)) return { ok: false, error: 'rejected_script', hint: 'Script contains open() — forbidden' };
  return { ok: true };
}

/**
 * Extract base_url from the script (from the generated template literals).
 */
function extractBaseUrl(scriptContent) {
  // Look for http://... or https://... in backtick template literals
  const m = scriptContent.match(/`(https?:\/\/[^/`$]+)/);
  return m ? m[1] : null;
}

/**
 * Run a k6 test script and return parsed metrics.
 *
 * @param {string} scriptContent - k6 JavaScript source
 * @returns {object} result
 */
async function runTest(scriptContent) {
  // 1. Validate script
  const validation = validateScript(scriptContent);
  if (!validation.ok) return validation;

  // 2. k6 preflight
  const k6Check = checkK6();
  if (!k6Check.ok) return k6Check;

  // 3. Extract base URL and check target
  const baseUrl = extractBaseUrl(scriptContent);
  if (baseUrl) {
    const targetCheck = await checkTarget(baseUrl);
    if (!targetCheck.ok) return targetCheck;
  }

  // 4. Derive run timeout from the script's total ramp duration
  // Sum all stage durations so the timeout covers the full ramping-vus run
  const stageDurs = [...scriptContent.matchAll(/duration:\s*'(\d+s)'/g)]
    .map(m => parseDuration(m[1]));
  const durS = stageDurs.length > 0 ? stageDurs.reduce((a, b) => a + b, 0) : 60;

  // 5. Write script to temp file
  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const tmpScript = path.join(RESULTS_DIR, `run-${Date.now()}.js`);
  const summaryFile = path.join(RESULTS_DIR, 'summary.json');
  const streamFile = path.join(RESULTS_DIR, 'stream.json');

  fs.writeFileSync(tmpScript, scriptContent, 'utf8');

  const startMs = Date.now();

  // 6. Execute k6
  const timeoutMs = (durS + 10) * 1000;
  const result = spawnSync(
    'k6',
    [
      'run',
      '--out', `json=${streamFile}`,
      `--summary-export=${summaryFile}`,
      '--quiet',
      tmpScript,
    ],
    {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    }
  );

  const elapsedMs = Date.now() - startMs;

  // Clean up temp script
  try { fs.unlinkSync(tmpScript); } catch {}

  if (result.error && result.error.code === 'ETIMEDOUT') {
    return { error: 'target_not_reachable', hint: 'k6 run timed out' };
  }

  // 7. Parse summary.json
  let summary;
  try {
    summary = JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
  } catch {
    return { error: 'target_not_reachable', hint: 'k6 did not produce summary.json — check that the target is running' };
  }

  const metrics = summary.metrics || {};
  const p95 = metrics.http_req_duration && metrics.http_req_duration.values
    ? (metrics.http_req_duration.values['p(95)'] || 0)
    : 0;
  const failRate = metrics.http_req_failed && metrics.http_req_failed.values
    ? (metrics.http_req_failed.values.rate || 0)
    : 0;
  const rps = metrics.http_reqs && metrics.http_reqs.values
    ? (metrics.http_reqs.values.rate || 0)
    : 0;

  // Abort signal for high error rate
  if (failRate > MAX_ERROR_RATE) {
    return {
      ok: false,
      error: 'high_error_rate',
      hint: `Error rate ${(failRate * 100).toFixed(1)}% exceeds 20% safety cap`,
      p95_ms: Math.round(p95),
      error_rate_pct: Math.round(failRate * 100),
      rps: Math.round(rps * 10) / 10,
      elapsed_ms: elapsedMs,
    };
  }

  // Build thresholds map
  const thresholds = {};
  for (const [k, v] of Object.entries(summary.thresholds || {})) {
    thresholds[k] = v.ok !== false;
  }

  return {
    ok: true,
    p95_ms: Math.round(p95),
    error_rate_pct: Math.round(failRate * 100),
    rps: Math.round(rps * 10) / 10,
    thresholds,
    elapsed_ms: elapsedMs,
  };
}

module.exports = { runTest };
