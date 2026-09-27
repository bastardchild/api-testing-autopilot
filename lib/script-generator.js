// lib/script-generator.js
// Emit valid k6 JavaScript from an endpoint list.
// Generates human-like traffic: ramping VUs, random endpoint selection,
// variable think time, and randomised request bodies.
// Optionally accepts schema data from scan_schema to build realistic request bodies.

'use strict';

const { URL } = require('url');

const DEFAULT_VUS = 10;
const DEFAULT_DURATION = '60s';
const DEFAULT_THINK_MIN = 0.5;   // seconds
const DEFAULT_THINK_MAX = 2.5;   // seconds

/**
 * Replace path params with Math.random-based values so each request
 * hits a different resource ID — more realistic than always using '1'.
 *   {id}, {user_id}  ->  ${Math.ceil(Math.random() * 100)}
 *   {slug}, {name}   ->  ${'item_' + Math.random().toString(36).slice(2)}
 */
function substituteParams(urlPattern) {
  return urlPattern.replace(/\{([^}]+)\}/g, (_m, name) => {
    const isNumeric = /^(id|[a-z_]*_id|num|count|page|limit|offset)$/i.test(name);
    return isNumeric
      ? '${Math.ceil(Math.random() * 100)}'
      : "${'item_' + Math.random().toString(36).slice(2)}";
  });
}

/**
 * Guess the table name from a URL pattern.
 * /api/v1/users/{id}  ->  'users'
 * /api/products       ->  'products'
 * Returns null if no match.
 */
function tableFromPath(urlPattern) {
  // Strip path params, split on '/', take last meaningful segment
  const segments = urlPattern
    .replace(/\{[^}]+\}/g, '')   // remove {params}
    .split('/')
    .map(s => s.trim())
    .filter(s => s && !/^v\d+$/.test(s) && s !== 'api'); // skip 'api', 'v1', 'v2'…
  return segments.length > 0 ? segments[segments.length - 1].toLowerCase() : null;
}

/**
 * Build a JSON body object from schema columns.
 * Skips nullable columns — only required fields go in the body.
 * Returns a plain object literal string for embedding in JS source.
 */
/**
 * Build a randomised k6 body expression from schema columns.
 * Each field uses a runtime-random value so no two requests are identical.
 */
function buildBodyFromSchema(columns) {
  const required = columns.filter(c => !c.nullable);
  const fields = required.length > 0 ? required : columns.slice(0, 5);
  const parts = fields.map(col => {
    let valExpr;
    switch (col.type) {
      case 'number':  valExpr = 'Math.floor(Math.random() * 1000)'; break;
      case 'boolean': valExpr = 'Math.random() > 0.5'; break;
      case 'object':  valExpr = '{}'; break;
      case 'string':
      default:
        if (/email/i.test(col.column)) {
          valExpr = "'user_' + Math.random().toString(36).slice(2) + '@example.com'";
        } else if (/password|pass/i.test(col.column)) {
          valExpr = "'Pass_' + Math.random().toString(36).slice(2)";
        } else {
          valExpr = `'${col.column}_' + Math.random().toString(36).slice(2)`;
        }
    }
    return `    ${JSON.stringify(col.column)}: ${valExpr}`;
  });
  return `{\n${parts.join(',\n')}\n  }`;
}

/**
 * Build a fallback randomised body when no schema is available.
 */
function buildFallbackBody() {
  return `{ _test: Math.random().toString(36).slice(2) }`;
}

/**
 * Build a k6 http call for one endpoint.
 * @param {object} ep        - endpoint from scan_codebase
 * @param {string} baseUrl
 * @param {object} schema    - { tableName -> columns[] } from scan_schema (may be null)
 * @param {object} auth      - { apiKey?: string, apiHeader?: string } (may be null)
 */
/**
 * Build a single arrow-function entry for the ENDPOINTS pool.
 * Each entry is   () => <http call>
 *
 * @param {object} ep     - endpoint from scan_codebase
 * @param {string} baseUrl
 * @param {object} schema - { tableName -> columns[] } (may be null)
 * @param {object} auth   - { apiKey, apiHeader } (may be null)
 */
function buildPoolEntry(ep, baseUrl, schema, auth) {
  const url = `\`${baseUrl}${substituteParams(ep.url_pattern)}\``;
  const method = ep.method.toUpperCase();
  const commentLine = `  // ${ep.file}:${ep.line} [${ep.lang}] conf=${ep.confidence}`;

  const paramsArg = auth && auth.apiKey ? ', params' : '';

  if (method === 'GET' || method === 'HEAD' || method === 'DELETE') {
    const fn = method === 'DELETE' ? 'del' : method.toLowerCase();
    return `${commentLine}\n  () => http.${fn}(${url}${paramsArg}),`;
  }

  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    let bodyExpr;
    let schemaNote = '';
    if (schema) {
      const tableName = tableFromPath(ep.url_pattern);
      const columns = tableName && schema[tableName];
      if (columns && columns.length > 0) {
        bodyExpr = buildBodyFromSchema(columns);
        schemaNote = ` // schema: ${tableName}`;
      }
    }
    if (!bodyExpr) bodyExpr = buildFallbackBody();

    const headersExpr = auth && auth.apiKey
      ? `Object.assign({ 'Content-Type': 'application/json' }, params.headers)`
      : `{ 'Content-Type': 'application/json' }`;

    return `${commentLine}${schemaNote}\n  () => http.${method.toLowerCase()}(${url}, JSON.stringify(${bodyExpr}), { headers: ${headersExpr} }),`;
  }

  // ANY / unknown method — fall back to GET
  return `${commentLine}\n  () => http.get(${url}${paramsArg}), // ${method} → GET`;
}

/**
 * Derive ramping-vus stages from a target VU count and a total duration string.
 * Shape: 15% ramp-up → 70% hold → 15% ramp-down  (human-like bell curve).
 */
function buildStages(targetVus, duration) {
  const totalS = parseDuration(duration);
  const rampS  = Math.max(5, Math.round(totalS * 0.15));
  const holdS  = Math.max(5, totalS - rampS * 2);
  return [
    `      { duration: '${rampS}s', target: ${targetVus} },  // ramp up`,
    `      { duration: '${holdS}s', target: ${targetVus} },  // hold`,
    `      { duration: '${rampS}s', target: 0 },             // ramp down`,
  ].join('\n');
}

function parseDuration(s) {
  const m = String(s).match(/^(\d+)(s|m)$/);
  if (!m) return 60;
  return m[2] === 'm' ? Number(m[1]) * 60 : Number(m[1]);
}

/**
 * Generate a k6 script from an endpoint list.
 *
 * Human-like behaviour baked in:
 *   - ramping-vus executor  (ramp up → hold → ramp down)
 *   - random endpoint selection per iteration (each VU acts independently)
 *   - variable think time: sleep(rand(think_min, think_max))
 *   - randomised path params and POST/PUT body values
 *
 * @param {object[]} endpoints - from scan_codebase
 * @param {object}   options   - { base_url, vus, duration, thresholds,
 *                                 think_min, think_max, schema,
 *                                 apiKey, apiHeader }
 * @returns {{ script, endpoint_count, vus, duration, schema_tables_used, api_key_injected }}
 */
function generateTestScript(endpoints, options = {}) {
  const {
    base_url,
    vus        = DEFAULT_VUS,
    duration   = DEFAULT_DURATION,
    thresholds = {},
    think_min  = DEFAULT_THINK_MIN,
    think_max  = DEFAULT_THINK_MAX,
    schema     = null,
    apiKey     = null,
    apiHeader  = 'X-API-Key',
  } = options;

  // Unwrap schema.tables if the full scan_schema result was passed in
  const tables = schema && schema.tables ? schema.tables : schema;

  if (!base_url) {
    throw new Error('base_url is required. Provide the API root, e.g. http://localhost:3000');
  }
  try { new URL(base_url); } catch {
    throw new Error(`base_url is not a valid URL: ${base_url}`);
  }

  // Only route endpoints (client calls are evidence, not load-test targets)
  const targets = endpoints.filter(ep => ep.kind === 'route' || !ep.kind);

  const targetVus = Number(vus) || DEFAULT_VUS;   // no hard cap — caller decides

  const safeThresholds = {
    http_req_failed: ['rate<0.1'],
    http_req_duration: ['p(95)<2000'],
    ...thresholds,
  };

  const auth = apiKey ? { apiKey, apiHeader } : null;

  // Build the ENDPOINTS pool — one arrow-function per route
  const schemaTablesUsed = new Set();
  const poolEntries = targets.map(ep => {
    if (tables) {
      const t = tableFromPath(ep.url_pattern);
      if (t && tables[t]) schemaTablesUsed.add(t);
    }
    return buildPoolEntry(ep, base_url, tables, auth);
  }).join('\n');

  const thresholdLines = Object.entries(safeThresholds)
    .map(([k, v]) => `    ${k}: ${JSON.stringify(v)},`)
    .join('\n');

  const stages     = buildStages(targetVus, duration);
  const paramsDecl = auth
    ? `  const params = { headers: { '${auth.apiHeader}': '${auth.apiKey}' } };\n`
    : '';

  const tMin = Number(think_min).toFixed(1);
  const tMax = Number(think_max).toFixed(1);

  const script = `import http from 'k6/http';
import { sleep } from 'k6';

// Human-like traffic: ramp up → hold → ramp down
export const options = {
  scenarios: {
    api_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
${stages}
      ],
    },
  },
  thresholds: {
${thresholdLines}
  },
};

// Endpoint pool — each VU picks one at random per iteration
const ENDPOINTS = [
${poolEntries}
];

export default function () {
${paramsDecl}  // Pick a random endpoint — mimics a real visitor navigating to one page
  const call = ENDPOINTS[Math.floor(Math.random() * ENDPOINTS.length)];
  call();

  // Variable think time (${tMin}–${tMax}s) — no synchronized herd effect
  sleep(${tMin} + Math.random() * ${(Number(tMax) - Number(tMin)).toFixed(1)});
}
`;

  return {
    script,
    endpoint_count: targets.length,
    vus: targetVus,
    duration,
    schema_tables_used: [...schemaTablesUsed],
    api_key_injected: !!auth,
  };
}

module.exports = { generateTestScript };
