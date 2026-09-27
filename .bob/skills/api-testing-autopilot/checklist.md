# Pre-demo Acceptance Checklist

Run these checks before recording the demo video.

## Environment
- [ ] `node --version` → v18+ 
- [ ] `npm install` completes, no native compilation errors
- [ ] `npm run smoke` → All 4 grammars: **loaded**
- [ ] `k6 version` → prints k6 version string

## Demo API (Express)
- [ ] `npm run demo:up` starts without errors
- [ ] `curl http://localhost:3000/health` → `{"status":"ok",...}`
- [ ] `npm run demo:down` (Ctrl-C) stops cleanly

## Scanning
- [ ] `scan_codebase("./examples/demo-api")` finds 5-8 routes
- [ ] `scan_codebase("./examples/demo-api-go")` finds 6-8 routes **without Go installed**
- [ ] Nested Go routes resolve to full paths (e.g. `/api/v1/products/{id}`)
- [ ] Path params normalized: `:id` → `{id}`, `<id>` → `{id}`

## Script generation
- [ ] `generate_test_script` output passes `k6 inspect <file>`
- [ ] Script contains `import http from 'k6/http'`

## Runner
- [ ] `run_test` with demo-api running → returns `p95_ms`, `error_rate_pct`, `rps`
- [ ] `run_test` with demo-api stopped → `target_not_reachable` error
- [ ] `generate_test_script` with `base_url: "https://example.com"` → `whitelist_blocked`

## Security
- [ ] `full_autopilot` with non-whitelisted host → rejected before scan
- [ ] `whitelist.json` is unchanged from `["localhost","127.0.0.1"]`
