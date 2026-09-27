// lib/schema-scanner.js
// Scan a project for database schema definitions.
// Supports: SQL migration files (.sql), Prisma (schema.prisma).
// No DB connection required — pure file parsing.
//
// Returns:
// {
//   tables: { tableName -> [{ column, type, nullable, placeholder }] },
//   sources: [{ file, kind }],
//   skipped_files: 0,
//   elapsed_ms: 0
// }

'use strict';

const fs   = require('fs');
const path = require('path');
const { parseSQLSchema }    = require('./langs/sql');
const { parsePrismaSchema } = require('./langs/prisma');

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage',
  '__pycache__', 'vendor', '.next',
]);

/**
 * Recursively collect files matching a predicate.
 */
function collectFiles(rootPath, predicate) {
  const results = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && predicate(e.name)) results.push(full);
    }
  }
  walk(rootPath);
  return results;
}

/**
 * Merge two schema maps — later entries win on collision.
 */
function mergeSchemas(target, source) {
  for (const [table, cols] of Object.entries(source)) {
    if (!target[table]) {
      target[table] = cols;
    } else {
      // Merge columns — add any not already present
      const existing = new Set(target[table].map(c => c.column));
      for (const col of cols) {
        if (!existing.has(col.column)) target[table].push(col);
      }
    }
  }
}

/**
 * Scan a project directory for schema definitions.
 *
 * @param {string} scanPath - project root
 * @returns {object} schema result
 */
async function scanSchema(scanPath) {
  const startMs = Date.now();
  const absPath = path.resolve(scanPath);

  if (!fs.existsSync(absPath)) {
    throw new Error(`Path not found: ${absPath}`);
  }

  const tables = {};
  const sources = [];
  let skippedFiles = 0;

  // ── SQL migration files ───────────────────────────────────────────────────
  const sqlFiles = collectFiles(absPath, name =>
    name.endsWith('.sql') ||
    // Common migration directory naming patterns
    /\d+.*\.sql$/.test(name)
  );

  for (const filePath of sqlFiles) {
    let source;
    try { source = fs.readFileSync(filePath, 'utf8'); } catch { skippedFiles++; continue; }
    try {
      const parsed = parseSQLSchema(source);
      if (Object.keys(parsed).length > 0) {
        mergeSchemas(tables, parsed);
        sources.push({ file: path.relative(absPath, filePath), kind: 'sql' });
      }
    } catch { skippedFiles++; }
  }

  // ── Prisma schema files ───────────────────────────────────────────────────
  const prismaFiles = collectFiles(absPath, name =>
    name === 'schema.prisma' || name.endsWith('.prisma')
  );

  for (const filePath of prismaFiles) {
    let source;
    try { source = fs.readFileSync(filePath, 'utf8'); } catch { skippedFiles++; continue; }
    try {
      const parsed = parsePrismaSchema(source);
      if (Object.keys(parsed).length > 0) {
        mergeSchemas(tables, parsed);
        sources.push({ file: path.relative(absPath, filePath), kind: 'prisma' });
      }
    } catch { skippedFiles++; }
  }

  return {
    tables,
    sources,
    skipped_files: skippedFiles,
    elapsed_ms: Date.now() - startMs,
  };
}

module.exports = { scanSchema };
