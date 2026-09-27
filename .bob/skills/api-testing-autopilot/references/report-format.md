# Report Format

When `full_autopilot` or individual tools return results, structure your response as follows:

## Scan Results
- **Endpoints found:** N (M routes, K client calls)
- **Languages scanned:** [list]
- **Languages skipped:** [list, if any]

## Endpoints Discovered

| # | Method | Path | File | Line | Framework | Auth | Confidence |
|---|--------|------|------|------|-----------|------|------------|
| 1 | GET | /api/users | routes/users.js | 5 | express | bearer | 1.0 |
| ... |

## Load Test Results
- **p95 latency:** Xms
- **Error rate:** X%
- **Throughput:** X req/s
- **Thresholds passed:** yes/no

## Notes
- Any skipped files or languages
- Any confidence < 0.7 endpoints (review recommended)
- If target was unreachable or k6 missing, say so clearly
