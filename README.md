# API Testing Autopilot

> Scan a codebase → find every API endpoint → generate a k6 load test → run it. One command.

Undocumented APIs get discovered twice: once by a developer reading code, and again by a tester hand-writing load scripts. Autopilot collapses both into one deterministic pass.

## What it does

- **Scans** JS, TS, Python, and Go codebases using pure AST parsing — no LLM guesses a URL.
- **Generates** valid k6 load test scripts from the discovered endpoints.
- **Runs** the test and returns p95 latency, error rate, and req/s — never raw k6 logs.

## Prerequisites

- [Node.js](https://nodejs.org) v18 or later
- [k6](https://k6.io/docs/get-started/installation/) — required only for `run_test` and `full_autopilot`

## Installation

```bash
git clone <repo-url>
cd api-testing-autopilot
npm install
```

No native compilation step. All parsers run as WASM in Node.

## k6 Installation

| Platform | Command |
|----------|---------|
| macOS    | `brew install k6` |
| Windows  | `choco install k6` |
| Linux    | `sudo apt-get install k6` |
| Docker   | `docker run --rm grafana/k6 run - <script.js` |

Verify: `k6 version`

## MCP Registration

Bob spawns the server as a subprocess over stdio.

Open it from Bob: **Settings → MCP → Edit Project MCP** (or Edit Global MCP), then paste:

```json
{
  "mcpServers": {
    "api-testing-autopilot": {
      "command": "node",
      "args": ["index.js"],
      "cwd": "/absolute/path/to/api-testing-autopilot"
    }
  }
}
```

Replace `/absolute/path/to/api-testing-autopilot` with the actual directory where you cloned this repo.

| Scope | Config file | When to use |
|-------|-------------|-------------|
| Project | `.bob/mcp.json` in your project root | Shared with your team via git |
| Global | `~/.bob/mcp.json` | Available in every workspace on your machine |

## Skill Registration

The Bob skill teaches Bob how to use the four MCP tools automatically.

**Project-level** (recommended — lives alongside your code):
```bash
cp -r /path/to/api-testing-autopilot/.bob/skills/api-testing-autopilot \
      /your/project/.bob/skills/
```

**Global** (available in every project):
```bash
cp -r /path/to/api-testing-autopilot/.bob/skills/api-testing-autopilot \
      ~/.bob/skills/
```

If the same skill name exists in both, the project-level skill wins.

## Tools at a glance

| Tool | What it does |
|------|-------------|
| `scan_codebase` | Find every API endpoint in your source code |
| `scan_schema` | Read your database schema from SQL migrations or Prisma |
| `generate_test_script` | Turn endpoints + schema into a runnable k6 script |
| `run_test` | Run the script, return clean metrics |
| `full_autopilot` | All of the above in one call |

---

## Quick Start — load test your own site

**Step 1.** Add your host to `configs/whitelist.json` (see [Remote Hosts](#remote-hosts) below for the full format):
```json
{
  "hosts": ["localhost", "127.0.0.1", "my-api.internal"],
  "remote": []
}
```

**Step 2.** Ask Bob in one sentence:
```
Load test my API at ./my-project against http://my-api.internal:8080
```

Bob will call `full_autopilot`, scan your source, generate the k6 script, run it,
and reply with a table of p95 latency, error rate, and req/s — no manual steps.

---

## Tools

There are four MCP tools. Use them individually for full control, or use
`full_autopilot` to chain all three steps in one call.

---

### `full_autopilot` — one command, complete result

The easiest way to get started. Scans your code, generates a k6 script, and runs it.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | ✅ | Directory to scan (your project root) |
| `base_url` | string | ✅ | Where the API is running, e.g. `http://localhost:3000` |
| `vus` | number | | Peak virtual users. Default: 10. No hard cap. |
| `duration` | string | | Total duration including ramp-up/down, e.g. `60s`, `5m`. Default: `60s`. |
| `think_min` | number | | Minimum seconds to pause between requests per VU. Default: `0.5` |
| `think_max` | number | | Maximum seconds to pause between requests per VU. Default: `2.5` |

**Example — light smoke test:**
```
full_autopilot('./my-api', 'http://localhost:8080', 20, '60s')
```

**Example — realistic load test:**
```
full_autopilot('./my-api', 'http://localhost:8080', 500, '5m')
```

**Returns:**
```json
{
  "endpoints_found": 9,
  "languages_scanned": ["go"],
  "test_results": {
    "ok": true,
    "p95_ms": 42,
    "error_rate_pct": 0,
    "rps": 312.4,
    "thresholds": { "http_req_duration": true, "http_req_failed": true },
    "elapsed_ms": 31200
  },
  "elapsed_ms": 33100
}
```

**What the numbers mean:**
- `p95_ms` — 95% of requests completed in this many milliseconds. Under 200 ms is fast; over 2000 ms is a problem.
- `error_rate_pct` — percentage of requests that failed (non-2xx or network error). Over 1% warrants investigation.
- `rps` — requests per second your API handled under that load.

**How the traffic looks:**

Traffic follows a bell-curve shape — not a flat rectangle. With `vus=200, duration=2m` the script produces three stages automatically:

```
VUs
200 |        ████████████████████████████████████████████████████
    |      ██                                                    ██
    |    ██                                                        ██
  0 |████                                                            ████
     0s  18s                                                     102s 120s
          ramp-up (15%)         hold (70%)           ramp-down (15%)
```

Each VU independently picks **one random endpoint** per iteration and sleeps for a random duration between `think_min` and `think_max` — no two VUs are in sync.

---

### `scan_codebase` — discover endpoints without running anything

Use this first if you want to review what was found before generating a test.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | ✅ | Project root to scan |
| `langs` | string[] | | Hint scanner to specific languages, e.g. `["go", "ts"]`. Auto-detected by default. |
| `since_branch` | string | | Only scan files changed since this git branch, e.g. `"main"` |

**Example:**
```
scan_codebase('./my-api')
```

**Returns a list of every endpoint found:**
```json
{
  "endpoints": [
    {
      "method": "GET",
      "url_pattern": "/api/users/{id}",
      "file": "routes/users.js",
      "line": 12,
      "lang": "js",
      "framework": "express",
      "auth": "bearer",
      "confidence": 1.0,
      "kind": "route"
    }
  ],
  "languages_scanned": ["javascript"],
  "languages_skipped": [],
  "skipped_files": 0,
  "elapsed_ms": 63
}
```

**Confidence scores** tell you how certain the scanner is about each endpoint:

| Score | Meaning |
|-------|---------|
| 1.0 | Static string — exact URL known |
| 0.7 | Template literal or composed path |
| 0.6 | Group-prefixed route (prefix resolved) |
| 0.5 | Method inferred from handler body |
| 0.4 | Fully dynamic — review manually |

**`kind` field:**
- `route` — a server-side route definition (what your API exposes)
- `client_call` — an outbound HTTP call your code makes to another API

---

### `scan_schema` — read your database structure

Finds SQL migration files and Prisma `schema.prisma` files in your project and
returns every table with its columns and types. No database connection needed.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | ✅ | Project root to scan |

**Supported sources:**

| Source | Files matched |
|--------|--------------|
| SQL migrations | Any `.sql` file containing `CREATE TABLE` |
| Prisma | `schema.prisma` or any `*.prisma` file |

**Example:**
```
scan_schema('./my-api')
```

**Returns:**
```json
{
  "tables": {
    "users": [
      { "column": "name",     "type": "string",  "nullable": false, "placeholder": "test_name" },
      { "column": "email",    "type": "string",  "nullable": false, "placeholder": "test@example.com" },
      { "column": "password", "type": "string",  "nullable": false, "placeholder": "Test1234!" },
      { "column": "price",    "type": "number",  "nullable": false, "placeholder": 1.0 }
    ],
    "products": [ ... ]
  },
  "sources": [
    { "file": "migrations/001_init.sql", "kind": "sql" }
  ],
  "skipped_files": 0,
  "elapsed_ms": 3
}
```

**Pass the result directly to `generate_test_script`:**

```
const schema = scan_schema('./my-api')
const endpoints = scan_codebase('./my-api')
generate_test_script(endpoints, { base_url: '...', schema: schema })
```

This replaces `{ _test: true }` in POST/PUT/PATCH bodies with real column names
and type-appropriate values — far fewer 400 validation errors during the load test.

**Type mapping:**

| SQL / Prisma type | Generated value example |
|-------------------|------------------------|
| VARCHAR, TEXT, String | `"test_name"`, `"test@example.com"` (name-aware) |
| INT, SERIAL, Int | `1` |
| DECIMAL, FLOAT, Float | `1.0` |
| BOOLEAN, Boolean | `true` |
| JSON, JSONB, Json | `{}` |
| TIMESTAMP, DateTime | `"2024-01-01T00:00:00Z"` |

---

### `generate_test_script` — turn an endpoint list into a k6 script

Use this when you want to customise the script before running it — add auth headers,
change thresholds, or review what will be sent.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `endpoints` | array | ✅ | Output of `scan_codebase` |
| `options.base_url` | string | ✅ | API root URL, e.g. `http://localhost:3000` |
| `options.vus` | number | | Peak virtual users. Default: 10. No hard cap. |
| `options.duration` | string | | Total duration including ramp-up/down. Default: `60s`. |
| `options.think_min` | number | | Min think time per iteration in seconds. Default: `0.5` |
| `options.think_max` | number | | Max think time per iteration in seconds. Default: `2.5` |
| `options.thresholds` | object | | Custom pass/fail thresholds (k6 threshold syntax) |

**Example with custom thresholds:**
```
generate_test_script(endpoints, {
  base_url: 'http://localhost:3000',
  vus: 20,
  duration: '60s',
  thresholds: {
    'http_req_duration': ['p(95)<500'],
    'http_req_failed': ['rate<0.01']
  }
})
```

**Returns:**
```json
{
  "script": "import http from 'k6/http';\n...",
  "endpoint_count": 9,
  "vus": 20,
  "duration": "60s"
}
```

You can save the script, edit it to add auth headers or request bodies, then pass it to `run_test`.

---

### `run_test` — run any k6 script and get back clean metrics

Use this after editing a generated script, or to re-run a previous test.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `script_content` | string | ✅ | A valid k6 JavaScript script |

**Returns:**
```json
{
  "ok": true,
  "p95_ms": 84,
  "error_rate_pct": 0,
  "rps": 145.2,
  "thresholds": {
    "http_req_duration": true,
    "http_req_failed": true
  },
  "elapsed_ms": 31800
}
```

**Error responses** (when something goes wrong before the test even runs):

| `error` value | Meaning | Fix |
|---------------|---------|-----|
| `k6_missing` | k6 is not installed or not in PATH | Install k6 — see k6 Installation above |
| `target_not_reachable` | The API didn't respond to a warm-up request | Start your API first |
| `whitelist_blocked` | The target host is not in `configs/whitelist.json` | Add the hostname to the whitelist |
| `rejected_script` | Script contains `require()`, dynamic `import()`, or `open()` | Use only scripts from `generate_test_script` |
| `high_error_rate` | Error rate exceeded 20% during the run | Check your API is healthy before load testing |

---

## Usage

Start the demo API, then ask Bob naturally:

```bash
npm run demo:up        # starts Express demo on http://localhost:3000
```

Then in Bob:
```
"Scan my project at ./examples/demo-api"
```

Or call a tool directly:
```
full_autopilot('./examples/demo-api', 'http://localhost:3000', 10, '30s')
```

Verify grammars load at any time:
```bash
npm run smoke
```

## Remote Hosts

By default only `localhost` and `127.0.0.1` are allowed. To test against any other
host — including staging or internal environments — add it to `configs/whitelist.json`.

### Plain hostname (no authentication required)

Add the hostname to the `hosts` array:

```json
{
  "hosts": ["localhost", "127.0.0.1", "api.staging.internal"],
  "remote": []
}
```

The host is now allowed for `generate_test_script`, `run_test`, and `full_autopilot`.
No API key is sent.

### Remote host with an API key

Add an entry to the `remote` array with `host`, `key`, and `header`:

```json
{
  "hosts": ["localhost", "127.0.0.1"],
  "remote": [
    {
      "host": "api.staging.example.com",
      "key": "sk-abc123",
      "header": "X-API-Key"
    }
  ]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `host` | ✅ | Hostname only — no scheme or port, e.g. `api.staging.example.com` |
| `key` | ✅ | The secret value injected on every request |
| `header` | | HTTP header name. Defaults to `X-API-Key` if omitted |

When this host is targeted, `generate_test_script` automatically emits:

```js
const params = { headers: { 'X-API-Key': 'sk-abc123' } };
```

Every GET/DELETE call receives `params` as its second argument; every POST/PUT/PATCH
call merges the key header with `Content-Type: application/json`. You never have to
edit the generated script manually to add authentication.

**Common header names:**

| Auth scheme | `header` value | `key` value example |
|-------------|----------------|---------------------|
| Custom API key | `X-API-Key` | `sk-abc123` |
| Bearer token | `Authorization` | `Bearer eyJhbGci...` |
| Basic auth | `Authorization` | `Basic dXNlcjpwYXNz` |

### Multiple remote hosts

Add one object per host to the `remote` array:

```json
{
  "hosts": ["localhost", "127.0.0.1"],
  "remote": [
    { "host": "api.staging.example.com", "key": "sk-staging-123", "header": "X-API-Key" },
    { "host": "api.prod-readonly.example.com", "key": "Bearer eyJhb...", "header": "Authorization" }
  ]
}
```

### Backward compatibility

The old flat-array format still works without any changes:

```json
["localhost", "127.0.0.1"]
```

It is treated as `{ "hosts": [...], "remote": [] }` internally.

---

## Whitelist & Safety Caps

- Only hosts in `configs/whitelist.json` are ever contacted — enforced in code, not convention
- **No VU or duration cap** — set whatever your target can handle
- Abort if error rate exceeds 20%
- The whitelist is never modified programmatically — edit the file directly

## Architecture

```
index.js                  MCP stdio server — 4 tools
├── lib/code-scanner.js   detect → lazy-load grammar → parse → merge → dedup
├── lib/script-generator.js   emit valid k6 JavaScript
├── lib/k6-runner.js      execute k6, parse summary.json, return metrics
├── lib/preflight.js      k6 installed? target reachable?
└── lib/langs/
    ├── registry.js       language manifest (extensions, WASM, lazy loaders)
    ├── javascript.js     Express/Fastify routes + axios/fetch client calls
    ├── typescript.js     TypeScript (re-uses javascript.js, marks lang: ts)
    ├── python.js         Flask/FastAPI routes + requests/httpx client calls
    └── go.js             net/http/gin/chi/gorilla + prefix tracking + method inference
```

## Impact

See [`impact-notes.md`](impact-notes.md) for before/after measurements on both demo codebases.
