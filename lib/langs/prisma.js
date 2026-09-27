// lib/langs/prisma.js
// Parse Prisma schema.prisma files for model definitions.
// No DB connection needed — pure file parsing.
// Returns: { modelName (lowercased) -> [{ column, type, nullable, placeholder }] }

'use strict';

const { placeholderValue } = require('./sql');

/**
 * Map a Prisma scalar type to our canonical kind.
 */
function prismaTypeToKind(raw) {
  const t = raw.replace('?', '').replace('[]', '').trim();
  switch (t) {
    case 'String':   return 'string';
    case 'Int':
    case 'BigInt':   return 'integer';
    case 'Float':
    case 'Decimal':  return 'number';
    case 'Boolean':  return 'boolean';
    case 'Json':     return 'object';
    case 'DateTime': return 'string';
    default:         return null; // relation or enum — skip
  }
}

/**
 * Parse a Prisma schema string.
 * Returns { tableName -> [{ column, type, nullable, placeholder }] }
 */
function parsePrismaSchema(source) {
  const schema = {};

  // Match model blocks:  model ModelName { ... }
  const modelRe = /model\s+(\w+)\s*\{([^}]+)\}/g;
  let modelMatch;

  while ((modelMatch = modelRe.exec(source)) !== null) {
    const modelName = modelMatch[1].toLowerCase();
    const body = modelMatch[2];
    const columns = [];

    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('//') || line.startsWith('@@')) continue;

      // Field line: fieldName  Type  [?]  [@attributes...]
      // e.g.  id        Int      @id @default(autoincrement())
      //       email     String   @unique
      //       bio       String?
      //       posts     Post[]   (relation — skip)
      const fieldMatch = line.match(/^(\w+)\s+(\w+)(\?)?(\[\])?/);
      if (!fieldMatch) continue;

      const column = fieldMatch[1];
      const rawType = fieldMatch[2];
      const optional = !!fieldMatch[3];
      const isList = !!fieldMatch[4];

      // Skip list fields (relations) and known meta fields
      if (isList) continue;

      const kind = prismaTypeToKind(rawType);
      if (!kind) continue; // relation type — skip

      // Skip auto-managed fields: id, createdAt, updatedAt
      if (/@id/.test(line) || /@updatedAt/.test(line)) continue;
      if (/@default/.test(line) && /@id/.test(line)) continue;

      columns.push({
        column,
        type: kind,
        nullable: optional,
        placeholder: placeholderValue(kind, column),
      });
    }

    if (columns.length > 0) {
      schema[modelName] = columns;
    }
  }

  return schema;
}

module.exports = { parsePrismaSchema };
