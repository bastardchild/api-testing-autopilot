// scripts/smoke-grammars.js
// Phase 1 gate: load all 4 WASM grammars and parse a one-line snippet each.
// Prints a table: language -> loaded/failed.

'use strict';

const path = require('path');
const fs = require('fs');

const SNIPPETS = {
  javascript: `app.get('/health', (req, res) => res.json({ ok: true }));`,
  typescript: `router.post('/users', async (req: Request, res: Response) => {});`,
  python: `@app.route('/users', methods=['GET'])\ndef list_users(): pass`,
  go: `mux.HandleFunc("GET /api/users", listUsers)`,
};

async function main() {
  const Parser = require('web-tree-sitter');
  await Parser.init();

  const REGISTRY = require('../lib/langs/registry');
  const results = [];

  for (const [langId, info] of Object.entries(REGISTRY)) {
    const wasmName = info.wasm;
    let wasmPath = null;

    // Priority 1: tree-sitter-wasms package
    const wasmsBundled = path.join(process.cwd(), 'node_modules', 'tree-sitter-wasms', 'out', wasmName);
    if (fs.existsSync(wasmsBundled)) {
      wasmPath = wasmsBundled;
    }

    // Priority 2: individual package + recursive search
    if (!wasmPath) {
      const candidates = [
        path.join(process.cwd(), 'node_modules', `tree-sitter-${langId}`, wasmName),
      ];
      try {
        const pkgDir = path.dirname(require.resolve(`tree-sitter-${langId}/package.json`));
        const found = findWasm(pkgDir, wasmName);
        if (found) candidates.push(found);
      } catch {}
      for (const c of candidates) {
        if (c && fs.existsSync(c)) { wasmPath = c; break; }
      }
    }

    if (!wasmPath) {
      results.push({ lang: langId, status: 'FAIL', reason: `WASM not found: ${wasmName}` });
      continue;
    }

    try {
      const language = await Parser.Language.load(wasmPath);
      const parser = new Parser();
      parser.setLanguage(language);
      const snippet = SNIPPETS[langId] || 'x = 1';
      const tree = parser.parse(snippet);
      const ok = tree && tree.rootNode && tree.rootNode.childCount >= 0;
      results.push({ lang: langId, status: ok ? 'loaded' : 'FAIL', wasmPath });
    } catch (err) {
      results.push({ lang: langId, status: 'FAIL', reason: err.message });
    }
  }

  // Print table
  console.log('\n┌──────────────┬───────────┬─────────────────────────────────────────────┐');
  console.log('│ Language     │ Status    │ WASM Path / Error                           │');
  console.log('├──────────────┼───────────┼─────────────────────────────────────────────┤');
  for (const r of results) {
    const lang = r.lang.padEnd(12);
    const status = r.status.padEnd(9);
    const detail = (r.wasmPath || r.reason || '').slice(0, 44).padEnd(44);
    console.log(`│ ${lang} │ ${status} │ ${detail}│`);
  }
  console.log('└──────────────┴───────────┴─────────────────────────────────────────────┘\n');

  const failed = results.filter(r => r.status !== 'loaded');
  if (failed.length > 0) {
    console.error('FAIL — Some grammars did not load:', failed.map(r => r.lang).join(', '));
    process.exit(1);
  } else {
    console.log('PASS — All 4 grammars loaded successfully.');
  }
}

function findWasm(dir, name) {
  const skip = new Set(['node_modules', '.git']);
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && e.name === name) return path.join(dir, e.name);
      if (e.isDirectory() && !skip.has(e.name)) {
        const found = findWasm(path.join(dir, e.name), name);
        if (found) return found;
      }
    }
  } catch {}
  return null;
}

main().catch(err => { console.error(err); process.exit(1); });
