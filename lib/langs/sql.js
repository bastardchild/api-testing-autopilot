// lib/langs/sql.js
// Parse SQL migration files for CREATE TABLE statements.
// No DB connection needed — pure file parsing.
// Returns: { tableName -> [{ column, type, nullable }] }

'use strict';

/**
 * Normalise a SQL type string to a canonical kind.
 *
 *   VARCHAR, TEXT, CHAR  -> 'string'
 *   INT, BIGINT, SERIAL  -> 'integer'
 *   FLOAT, DOUBLE, NUMERIC, DECIMAL -> 'number'
 *   BOOLEAN, BOOL        -> 'boolean'
 *   DATE, TIMESTAMP      -> 'string'  (ISO string in JSON)
 *   JSON, JSONB          -> 'object'
 *   UUID                 -> 'string'
 */
function normaliseType(raw) {
  const t = raw.toUpperCase().replace(/\(.*\)/, '').trim();
  if (/^(VARCHAR|TEXT|CHAR|TINYTEXT|MEDIUMTEXT|LONGTEXT|NVARCHAR|NCHAR|UUID|DATE|TIME|TIMESTAMP|DATETIME|YEAR)/.test(t)) return 'string';
  if (/^(INT|INTEGER|BIGINT|SMALLINT|TINYINT|MEDIUMINT|SERIAL|BIGSERIAL|SMALLSERIAL)/.test(t)) return 'integer';
  if (/^(FLOAT|DOUBLE|REAL|NUMERIC|DECIMAL|MONEY|SMALLMONEY)/.test(t)) return 'number';
  if (/^(BOOL|BOOLEAN)/.test(t)) return 'boolean';
  if (/^(JSON|JSONB)/.test(t)) return 'object';
  return 'string'; // safe default
}

/**
 * Generate a placeholder value for a column type and name.
 */
function placeholderValue(type, columnName) {
  const name = columnName.toLowerCase();
  if (type === 'boolean') return true;
  if (type === 'integer') return 1;
  if (type === 'number') return 1.0;
  if (type === 'object') return {};
  // string — use name-aware values
  if (name.includes('email')) return 'test@example.com';
  if (name.includes('password') || name.includes('pwd')) return 'Test1234!';
  if (name.includes('phone')) return '+1-555-0100';
  if (name.includes('url') || name.includes('link')) return 'https://example.com';
  if (name.includes('uuid') || name === 'id' || name.endsWith('_id')) return '00000000-0000-0000-0000-000000000001';
  if (name.includes('name')) return 'test_' + name;
  if (name.includes('date') || name.includes('at')) return '2024-01-01T00:00:00Z';
  if (name.includes('description') || name.includes('bio') || name.includes('content')) return 'test description';
  return 'test_' + name;
}

/**
 * Parse one CREATE TABLE block and return column definitions.
 */
function parseCreateTable(block) {
  const columns = [];
  // Strip comments
  const clean = block.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

  // Split on commas at the top level (not inside parens)
  const lines = [];
  let depth = 0;
  let current = '';
  for (const ch of clean) {
    if (ch === '(') { depth++; if (depth > 1) current += ch; }
    else if (ch === ')') { depth--; if (depth > 0) current += ch; else { lines.push(current); current = ''; } }
    else if (ch === ',' && depth === 1) { lines.push(current); current = ''; }
    else { current += ch; }
  }
  if (current.trim()) lines.push(current);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Skip constraints: PRIMARY KEY, UNIQUE, INDEX, CONSTRAINT, CHECK, FOREIGN KEY
    if (/^(PRIMARY\s+KEY|UNIQUE|INDEX|KEY|CONSTRAINT|CHECK|FOREIGN\s+KEY)/i.test(trimmed)) continue;

    // Column definition: `col_name` TYPE [NOT NULL] [DEFAULT ...] [...]
    const colMatch = trimmed.match(/^[`"]?([A-Za-z_][A-Za-z0-9_]*)[`"]?\s+([A-Za-z]+(?:\s*\([^)]*\))?)/i);
    if (colMatch) {
      const column = colMatch[1];
      const rawType = colMatch[2];
      const nullable = !/NOT\s+NULL/i.test(trimmed);
      const type = normaliseType(rawType);
      columns.push({ column, type, nullable, placeholder: placeholderValue(type, column) });
    }
  }
  return columns;
}

/**
 * Extract all CREATE TABLE definitions from a SQL string.
 * Returns { tableName -> [{ column, type, nullable, placeholder }] }
 */
function parseSQLSchema(sql) {
  const schema = {};
  // Match CREATE TABLE [IF NOT EXISTS] table_name ( ... )
  const tableRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?\s*\(/gi;
  let match;
  while ((match = tableRe.exec(sql)) !== null) {
    const tableName = match[1].toLowerCase();
    // Find the matching closing paren
    const start = match.index + match[0].length - 1; // position of opening (
    let depth = 0;
    let end = start;
    for (let i = start; i < sql.length; i++) {
      if (sql[i] === '(') depth++;
      else if (sql[i] === ')') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    const block = sql.slice(start, end);
    const columns = parseCreateTable(block);
    if (columns.length > 0) {
      schema[tableName] = columns;
    }
  }
  return schema;
}

module.exports = { parseSQLSchema, normaliseType, placeholderValue };
