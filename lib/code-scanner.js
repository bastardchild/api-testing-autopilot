// lib/code-scanner.js
// Core scanner: detect languages -> lazy-load grammars -> dispatch -> merge -> dedup.

'use strict';

const fs = require('fs');
const path = require('path');
const REGISTRY = require('./langs/registry');

// Directories to skip
const SKIP_DIRS = new Set([
  'node_modules', 'dist', '.git', 'venv', 'vendor', 'testdata', 'tests',
  '__pycache__', '.next', 'build', 'out', 'coverage',
]);

/**
 * Walk a directory recursively and collect file paths by extension.
 * Returns { langId -> [filePaths] }
 */
function collectFiles(rootPath) {
  const byLang = {};
  const extToLang = {};
  for (const [lang, info] of Object.entries(REGISTRY)) {
    for (const ext of info.ext) extToLang[ext] = lang;
  }

  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const lang = extToLang[ext];
        if (lang) {
          if (!byLang[lang]) byLang[lang] = [];
          byLang[lang].push(full);
        }
      }
    }
  }

  walk(rootPath);
  return byLang;
}

/**
 * Lazy-load web-tree-sitter and a specific WASM grammar.
 * Returns { Parser, language } or throws.
 */
async function loadGrammar(langId) {
  const info = REGISTRY[langId];
  if (!info) throw new Error(`No registry entry for ${langId}`);

  const Parser = require('web-tree-sitter');
  await Parser.init();

  // Locate the WASM file
  const wasmName = info.wasm;
  let wasmPath;

  // Priority 1: tree-sitter-wasms package (pre-compiled WASM bundle)
  const wasmsPkg = path.join(process.cwd(), 'node_modules', 'tree-sitter-wasms', 'out', wasmName);
  if (fs.existsSync(wasmsPkg)) {
    wasmPath = wasmsPkg;
  }

  // Priority 2: individual grammar package directory
  if (!wasmPath) {
    const candidates = [
      path.join(process.cwd(), 'node_modules', `tree-sitter-${langId}`, wasmName),
      path.join(path.dirname(require.resolve('web-tree-sitter')), wasmName),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) { wasmPath = c; break; }
    }
  }

  // Priority 3: recursive search in grammar package
  if (!wasmPath) {
    try {
      const pkgDir = path.dirname(require.resolve(`tree-sitter-${langId}/package.json`));
      const found = findWasm(pkgDir, wasmName);
      if (found) wasmPath = found;
    } catch {}
  }

  if (!wasmPath) throw new Error(`WASM not found: ${wasmName}`);

  const language = await Parser.Language.load(wasmPath);
  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
}

function findWasm(dir, name) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && e.name === name) return path.join(dir, e.name);
      if (e.isDirectory() && !SKIP_DIRS.has(e.name)) {
        const found = findWasm(path.join(dir, e.name), name);
        if (found) return found;
      }
    }
  } catch {}
  return null;
}

/**
 * Normalise all endpoints — uppercase method, {param} style.
 */
function normalizeEndpoints(endpoints) {
  return endpoints.map(ep => ({
    ...ep,
    method: ep.method.toUpperCase(),
    url_pattern: ep.url_pattern,
  }));
}

/**
 * Deduplicate on (method, url_pattern).
 * When the same endpoint appears as both route + client_call, keep route.
 */
function dedup(endpoints) {
  const map = new Map();
  for (const ep of endpoints) {
    const key = `${ep.method}:${ep.url_pattern}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, ep);
    } else if (existing.kind === 'client_call' && ep.kind === 'route') {
      map.set(key, ep); // prefer route definition
    }
  }
  return [...map.values()];
}

/**
 * Extract Express mount mappings from source text.
 * Handles both:
 *   app.use('/prefix', require('./routes/foo'))
 *   const fooRouter = require('./routes/foo'); app.use('/prefix', fooRouter)
 *   app.use('/prefix', middleware, fooRouter)
 */
function extractMountMappings(sourceText, sourceFile) {
  const mappings = [];
  const dir = path.dirname(sourceFile);

  // Pass 1: build varName -> requirePath map
  const varToPath = {};
  const varRe = /(?:const|let|var)\s+(\w+)\s*=\s*require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  let m;
  while ((m = varRe.exec(sourceText)) !== null) {
    varToPath[m[1]] = m[2];
  }

  // Pass 2: app.use('/prefix', ...) — last argument is the router
  const useRe = /app\.use\s*\(\s*['"`]([^'"`]+)['"`]\s*,((?:[^)]+))\)/g;
  while ((m = useRe.exec(sourceText)) !== null) {
    const prefix = m[1];
    const argsText = m[2];
    // Last identifier in the args is the router
    const identifiers = argsText.match(/\b([a-zA-Z_]\w*)\b/g) || [];
    for (const ident of identifiers.reverse()) {
      if (varToPath[ident]) {
        const requirePath = varToPath[ident];
        const resolved = path.join(dir, requirePath).replace(/\\/g, '/');
        mappings.push({ prefix, resolvedBase: resolved });
        break;
      }
    }

    // Also handle inline require
    const inlineRe = /require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
    let ir;
    while ((ir = inlineRe.exec(argsText)) !== null) {
      const resolved = path.join(dir, ir[1]).replace(/\\/g, '/');
      mappings.push({ prefix, resolvedBase: resolved });
    }
  }

  return mappings;
}

/**
 * Apply mount prefixes to router endpoints.
 * If a route endpoint's file matches a known router file, prepend its mount prefix.
 */
function applyMountPrefixes(allEndpoints, allSources) {
  // Build prefix map: normalizedFilePath -> prefix
  const prefixMap = new Map();
  for (const { source, filePath } of allSources) {
    const mounts = extractMountMappings(source, filePath);
    for (const { prefix, resolvedBase } of mounts) {
      // resolvedBase might lack extension — try with .js
      const candidates = [
        resolvedBase,
        resolvedBase + '.js',
        resolvedBase + '/index.js',
      ];
      for (const c of candidates) {
        const normalized = c.replace(/\\/g, '/');
        prefixMap.set(normalized, prefix);
      }
    }
  }

  if (prefixMap.size === 0) return allEndpoints;

  return allEndpoints.map(ep => {
    if (ep.kind !== 'route') return ep;
    // Try to match ep.file against known router mounts
    const epNorm = ep.file.replace(/\\/g, '/');
    for (const [base, prefix] of prefixMap) {
      // Match by suffix — e.g. "routes/users.js" matches ".../routes/users.js"
      if (base.endsWith(epNorm) || epNorm.endsWith(base.split('/').slice(-2).join('/'))) {
        const newPath = prefix.replace(/\/$/, '') + (ep.url_pattern === '/' ? '' : ep.url_pattern);
        return { ...ep, url_pattern: newPath || '/', prefix_tracked: true };
      }
    }
    return ep;
  });
}

/**
 * Main scan function.
 *
 * @param {string} scanPath  - directory to scan
 * @param {string[]} [langs] - hint (authoritative: extension detection)
 * @returns {object} scan result
 */
async function scanCodebase(scanPath, langs) {
  const startMs = Date.now();
  const absPath = path.resolve(scanPath);

  if (!fs.existsSync(absPath)) {
    throw new Error(`Path not found: ${absPath}`);
  }

  const byLang = collectFiles(absPath);
  const languagesFound = Object.keys(byLang);
  const languagesScanned = [];
  const languagesSkipped = [];
  let skippedFiles = 0;
  const allEndpoints = [];
  const allSources = []; // for mount-prefix resolution

  for (const langId of languagesFound) {
    const files = byLang[langId];
    if (!files || files.length === 0) continue;

    let parser;
    try {
      parser = await loadGrammar(langId);
    } catch (err) {
      languagesSkipped.push(langId);
      continue;
    }

    const langModule = REGISTRY[langId].load();
    languagesScanned.push(langId);

    for (const filePath of files) {
      let source;
      try { source = fs.readFileSync(filePath, 'utf8'); } catch { skippedFiles++; continue; }

      let tree;
      try { tree = parser.parse(source); } catch { skippedFiles++; continue; }

      const relPath = path.relative(absPath, filePath);
      allSources.push({ source, filePath: relPath });

      let found = [];
      try {
        found = langModule.extract(tree, relPath);
      } catch {
        skippedFiles++;
        continue;
      }

      allEndpoints.push(...found);
    }
  }

  const withPrefixes = applyMountPrefixes(allEndpoints, allSources);
  const normalized = normalizeEndpoints(withPrefixes);
  const deduped = dedup(normalized);
  // Cap at 50
  const endpoints = deduped.slice(0, 50);

  return {
    endpoints,
    languages_scanned: languagesScanned,
    languages_skipped: languagesSkipped,
    skipped_files: skippedFiles,
    elapsed_ms: Date.now() - startMs,
  };
}

module.exports = { scanCodebase };
