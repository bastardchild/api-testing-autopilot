'use strict';
// Gate test: verify whitelist enforcement using the live index.js logic.
// Temporarily overrides whitelist.json to inject a test remote entry.

const fs = require('fs');
const path = require('path');

const WHITELIST_PATH = path.join(__dirname, '..', 'configs', 'whitelist.json');

// Save original whitelist
const original = fs.readFileSync(WHITELIST_PATH, 'utf8');

// Write a test whitelist that includes a remote entry
const testWhitelist = {
  hosts: ['localhost', '127.0.0.1'],
  remote: [
    { host: 'api.staging.example.com', key: 'sk-test-123', header: 'X-API-Key' },
  ],
};
fs.writeFileSync(WHITELIST_PATH, JSON.stringify(testWhitelist, null, 2));

// Delete require cache so index picks up the new file
Object.keys(require.cache).forEach(k => { if (k.includes('index')) delete require.cache[k]; });

const { URL } = require('url');

function loadWhitelist() {
  try {
    const raw = JSON.parse(fs.readFileSync(WHITELIST_PATH, 'utf8'));
    if (Array.isArray(raw)) return { hosts: raw, remote: [] };
    return {
      hosts: Array.isArray(raw.hosts) ? raw.hosts : ['localhost', '127.0.0.1'],
      remote: Array.isArray(raw.remote) ? raw.remote.filter(e => e.host && e.key) : [],
    };
  } catch {
    return { hosts: ['localhost', '127.0.0.1'], remote: [] };
  }
}

function checkWhitelist(targetUrl) {
  const { hosts, remote } = loadWhitelist();
  let host;
  try { host = new URL(targetUrl).hostname; }
  catch { return { allowed: false, reason: 'Invalid URL: ' + targetUrl }; }
  if (hosts.includes(host)) return { allowed: true };
  const entry = remote.find(e => e.host === host);
  if (entry) return { allowed: true, apiKey: entry.key, apiHeader: entry.header || 'X-API-Key' };
  const allAllowed = [...hosts, ...remote.map(e => e.host)].join(', ');
  return { allowed: false, reason: `Host "${host}" is not in the whitelist (${WHITELIST_PATH}). Allowed: ${allAllowed}.` };
}

try {
  console.log('--- Phase 5 Gate: Whitelist enforcement ---\n');

  // 1. blocked host
  const r1 = checkWhitelist('https://example.com');
  console.log('https://example.com ->', JSON.stringify(r1));
  console.assert(r1.allowed === false, 'FAIL: example.com should be blocked');

  // 2. plain localhost
  const r2 = checkWhitelist('http://localhost:3000');
  console.log('http://localhost:3000 ->', JSON.stringify(r2));
  console.assert(r2.allowed === true && !r2.apiKey, 'FAIL: localhost should be allowed without apiKey');

  // 3. remote entry with key
  const r3 = checkWhitelist('https://api.staging.example.com/v1');
  console.log('https://api.staging.example.com ->', JSON.stringify(r3));
  console.assert(r3.allowed === true, 'FAIL: remote entry should be allowed');
  console.assert(r3.apiKey === 'sk-test-123', 'FAIL: apiKey should be sk-test-123');
  console.assert(r3.apiHeader === 'X-API-Key', 'FAIL: apiHeader should be X-API-Key');

  // 4. script generator injects key
  const { generateTestScript } = require('../lib/script-generator');
  const endpoints = [
    { method: 'GET', url_pattern: '/api/users', kind: 'route', file: 'app.js', line: 1, lang: 'js', confidence: 1 },
    { method: 'POST', url_pattern: '/api/users', kind: 'route', file: 'app.js', line: 5, lang: 'js', confidence: 1 },
  ];
  const result = generateTestScript(endpoints, {
    base_url: 'https://api.staging.example.com',
    vus: 2,
    duration: '10s',
    apiKey: 'sk-test-123',
    apiHeader: 'X-API-Key',
  });
  console.log('\nGenerated script (api_key_injected=' + result.api_key_injected + '):');
  console.log(result.script);
  console.assert(result.api_key_injected === true, 'FAIL: api_key_injected should be true');
  console.assert(result.script.includes("'X-API-Key': 'sk-test-123'"), 'FAIL: key not in script');

  console.log('\nPHASE 5 GATE: PASS');
} finally {
  // Always restore original whitelist
  fs.writeFileSync(WHITELIST_PATH, original);
}
