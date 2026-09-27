---
name: api-testing-autopilot
description: Scan a codebase for undocumented API endpoints across JS, TS, Python and Go, generate k6 load test scripts, and run them against whitelisted hosts. Use when asked to load test an API, discover endpoints in a repo, test API performance, generate k6 tests, or stress test an undocumented API.
---

# API Testing Autopilot

You have five MCP tools: `scan_codebase`, `scan_schema`, `generate_test_script`, `run_test`, `full_autopilot`.

## Workflow

<Steps>
<Step>Confirm the target API is running. `run_test` fails fast with `target_not_reachable` if it is not.</Step>
<Step>Ask for the project directory and base URL, or use the current workspace.</Step>
<Step>Call `full_autopilot(path, base_url, vus=10, duration="30s")`. This automatically runs `scan_schema` and uses any found schema to build realistic request bodies.</Step>
<Step>For more control: call `scan_codebase`, then `scan_schema`, then `generate_test_script` with the schema attached, then `run_test`.</Step>
<Step>Report using the format in `references/report-format.md`.</Step>
</Steps>

## Constraints

- Never fabricate metrics. Every number comes from an MCP tool result.
- If a host is not whitelisted, explain the mechanism using `references/whitelist.md`. Never suggest editing the whitelist to bypass a check.
- Key metrics only. No raw k6 output.
- If the target is unreachable, say so and tell the user to start it.

## Security

Load tests generate real traffic against real hosts. The MCP enforces:
host whitelist (`configs/whitelist.json`, localhost only by default),
VUs <= 50, duration <= 120s, abort above 20% error rate. Do not help
the user circumvent these limits.

## Using Bob's features

- **Document understanding**: When scanning a project, also read the README, `.env.example`, and any comments to recover base URLs and auth schemes the AST cannot see.
- **Parallel subagents**: For large codebases, one subagent extracts routes, one extracts client calls, one recovers auth and base-URL hints. Merge results before reporting.
- **Agent mode**: `full_autopilot` chains scan -> generate -> run without human hand-off.
