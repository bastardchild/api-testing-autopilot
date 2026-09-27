// index.js
// MCP server entry point — StdioServerTransport, 4 tools.
// Whitelist enforced before any network operation.

'use strict';

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

const { scanCodebase } = require('./lib/code-scanner');
const { generateTestScript } = require('./lib/script-generator');
const { runTest } = require('./lib/k6-runner');
const { scanSchema } = require('./lib/schema-scanner');

// ── Security ──────────────────────────────────────────────────────────────────

const WHITELIST_PATH = path.join(__dirname, 'configs', 'whitelist.json');

function loadWhitelist() {
  try {
    const raw = JSON.parse(fs.readFileSync(WHITELIST_PATH, 'utf8'));
    // Support legacy flat-array format: ["localhost","127.0.0.1"]
    if (Array.isArray(raw)) return { hosts: raw, remote: [] };
    return {
      hosts: Array.isArray(raw.hosts) ? raw.hosts : ['localhost', '127.0.0.1'],
      remote: Array.isArray(raw.remote)
        ? raw.remote.filter(e => e.host && e.key)   // strip comment/example entries
        : [],
    };
  } catch {
    return { hosts: ['localhost', '127.0.0.1'], remote: [] };
  }
}

/**
 * Check whether targetUrl is allowed.
 * Returns { allowed: true, apiKey?: string, apiHeader?: string }
 *      or { allowed: false, reason: string }
 * When a remote entry matches, apiKey and apiHeader are included so
 * the caller can inject the key into the generated script.
 */
function checkWhitelist(targetUrl) {
  const { hosts, remote } = loadWhitelist();
  let host;
  try {
    host = new URL(targetUrl).hostname;
  } catch {
    return { allowed: false, reason: `Invalid URL: ${targetUrl}` };
  }

  // Plain host match
  if (hosts.includes(host)) return { allowed: true };

  // Remote entry match — key required
  const entry = remote.find(e => e.host === host);
  if (entry) {
    return {
      allowed: true,
      apiKey: entry.key,
      apiHeader: entry.header || 'X-API-Key',
    };
  }

  const allAllowed = [...hosts, ...remote.map(e => e.host)].join(', ');
  return {
    allowed: false,
    reason: `Host "${host}" is not in the whitelist (${WHITELIST_PATH}). Allowed: ${allAllowed}. Add a remote entry to configs/whitelist.json to allow it.`,
  };
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'scan_codebase',
    description: 'Scan a project directory for API endpoints using AST parsing. Supports JS, TS, Python, and Go. Returns structured endpoint list with method, path, file, line, framework, auth, and confidence.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Project root directory to scan' },
        langs: { type: 'array', items: { type: 'string' }, description: 'Optional language hint (e.g. ["go","ts"])' },
        since_branch: { type: 'string', description: 'Optional git branch — scan only changed files' },
      },
      required: ['path'],
    },
  },
  {
    name: 'generate_test_script',
    description: 'Generate a valid k6 load test script from an endpoint list. Returns the script content and metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        endpoints: { type: 'array', description: 'Endpoint list from scan_codebase' },
        options: {
          type: 'object',
          properties: {
            base_url: { type: 'string', description: 'API base URL, e.g. http://localhost:3000' },
            vus: { type: 'number', description: 'Virtual users (peak). No hard cap — be responsible with remote hosts.' },
            duration: { type: 'string', description: 'Total test duration, e.g. 60s or 5m. Includes ramp-up and ramp-down.' },
            thresholds: { type: 'object', description: 'Custom k6 thresholds' },
            think_min: { type: 'number', description: 'Minimum think time between iterations in seconds. Default: 0.5' },
            think_max: { type: 'number', description: 'Maximum think time between iterations in seconds. Default: 2.5' },
          },
          required: ['base_url'],
        },
      },
      required: ['endpoints', 'options'],
    },
  },
  {
    name: 'run_test',
    description: 'Run a k6 script and return p95 latency, error rate, and req/s. Enforces host whitelist and safety caps. Never returns raw k6 logs.',
    inputSchema: {
      type: 'object',
      properties: {
        script_content: { type: 'string', description: 'k6 JavaScript source (from generate_test_script)' },
      },
      required: ['script_content'],
    },
  },
  {
    name: 'full_autopilot',
    description: 'One-shot: scan codebase -> generate k6 script -> run test. Whitelist check happens first.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Project root to scan' },
        base_url: { type: 'string', description: 'API base URL (must be whitelisted)' },
        vus: { type: 'number', description: 'Peak virtual users for the ramp. No hard cap.' },
        duration: { type: 'string', description: 'Total test duration including ramp-up/down, e.g. 60s or 5m.' },
      },
      required: ['path', 'base_url'],
    },
  },
  {
    name: 'scan_schema',
    description: 'Scan a project for database schema definitions (SQL migration files and Prisma schema.prisma). Returns table names and columns with types, used to generate realistic request bodies in generate_test_script. No database connection required.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Project root directory to scan for schema files' },
      },
      required: ['path'],
    },
  },
];

// ── Handler ───────────────────────────────────────────────────────────────────

async function handleTool(name, args) {
  if (name === 'scan_codebase') {
    const result = await scanCodebase(args.path, args.langs);
    return result;
  }

  if (name === 'scan_schema') {
    return await scanSchema(args.path);
  }

  if (name === 'generate_test_script') {
    const wl = args.options && args.options.base_url ? checkWhitelist(args.options.base_url) : { allowed: true };
    if (!wl.allowed) {
      return { error: 'whitelist_blocked', hint: wl.reason };
    }
    // Forward remote-host API key into the script options
    const opts = { ...args.options };
    if (wl.apiKey) { opts.apiKey = wl.apiKey; opts.apiHeader = wl.apiHeader; }
    return generateTestScript(args.endpoints, opts);
  }

  if (name === 'run_test') {
    return await runTest(args.script_content);
  }

  if (name === 'full_autopilot') {
    const startMs = Date.now();

    // Whitelist check FIRST
    const wl = checkWhitelist(args.base_url);
    if (!wl.allowed) {
      return { error: 'whitelist_blocked', hint: wl.reason };
    }

    // Scan code
    const scanResult = await scanCodebase(args.path);
    const routeEndpoints = scanResult.endpoints.filter(ep => ep.kind === 'route' || !ep.kind);

    // Scan schema (best-effort — never fails the autopilot)
    let schemaResult = null;
    try { schemaResult = await scanSchema(args.path); } catch {}

    // Generate — pass API key if host is a remote whitelisted entry
    let genResult;
    try {
      genResult = generateTestScript(routeEndpoints, {
        base_url: args.base_url,
        vus: args.vus || 10,
        duration: args.duration || '30s',
        schema: schemaResult,
        ...(wl.apiKey ? { apiKey: wl.apiKey, apiHeader: wl.apiHeader } : {}),
      });
    } catch (err) {
      return { error: 'generate_failed', hint: err.message };
    }

    // Run
    const testResult = await runTest(genResult.script);

    return {
      endpoints_found: scanResult.endpoints.length,
      languages_scanned: scanResult.languages_scanned,
      script_generated: genResult.script,
      test_results: testResult,
      elapsed_ms: Date.now() - startMs,
    };
  }

  throw new Error(`Unknown tool: ${name}`);
}

// ── Server bootstrap ──────────────────────────────────────────────────────────

const server = new Server(
  { name: 'api-testing-autopilot', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await handleTool(name, args || {});
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server runs until the parent process closes stdin
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
