# Troubleshooting

## k6 missing (`k6_missing`)

`run_test` returns `{ "error": "k6_missing" }` when k6 is not in PATH.

**Install k6:**
- macOS: `brew install k6`
- Windows: `choco install k6`
- Linux (apt): `sudo apt-get install k6`
- Docker: `docker run --rm grafana/k6 run - <script.js`

After installing, verify with `k6 version`.

---

## Target not reachable (`target_not_reachable`)

The warm-up GET to `base_url` failed before the test even started.

**Fix:** Start the demo API first:
```
npm run demo:up        # Express demo on port 3000
npm run demo:go        # Go demo on port 8080
```

Then retry. If the port changed, pass the correct `base_url`.

---

## Parse errors / skipped files

`scan_codebase` returns `skipped_files: N` when it could not parse N files.
This is non-fatal — scanning continues. Common causes:
- Syntax errors in source files
- Files with unexpected encoding

Check `languages_skipped` for grammars that failed to load entirely.

---

## Grammar failed to load

If a WASM grammar cannot be found, the language is added to
`languages_skipped` and scanning continues for other languages.

**Fix:** Run `npm install` to ensure all tree-sitter packages are installed.
Then run `npm run smoke` to verify all grammars load.

---

## Whitelist blocked (`whitelist_blocked`)

The target host is not in `configs/whitelist.json`.

See `references/whitelist.md` for how to add a host.
Never add a public host to the whitelist.
