// lib/langs/python.js
// Extract Flask/FastAPI/Django routes and requests/httpx client calls.

'use strict';

const id = 'python';
const extensions = ['.py'];
const frameworks = ['flask', 'fastapi', 'django'];

/**
 * Normalize Flask <int:id>, <id> and FastAPI {id} to {id}.
 */
function normalizePath(p) {
  if (!p) return p;
  // Flask <type:name> or <name>
  p = p.replace(/<(?:[a-z_]+:)?([A-Za-z_][A-Za-z0-9_]*)>/g, '{$1}');
  // Already {name} — leave as is
  return p;
}

function stringValue(node) {
  if (!node) return null;
  if (node.type === 'string') {
    const raw = node.text;
    // Python strings: 'x', "x", '''x''', """x"""
    if (raw.startsWith('"""') || raw.startsWith("'''")) {
      return raw.slice(3, raw.length - 3);
    }
    return raw.slice(1, raw.length - 1);
  }
  return null;
}

/**
 * Walk tree and collect Flask/FastAPI decorators and client calls.
 */
function extract(tree, filePath) {
  const endpoints = [];

  function visitNode(node) {
    // Flask/FastAPI decorator: @app.route('/path', methods=['GET','POST'])
    //                          @app.get('/path')  @router.post('/path')
    if (node.type === 'decorator') {
      const text = node.text;
      // @app.route(path, methods=[...])
      const routeMatch = text.match(/@\w+\.route\s*\(\s*['"]([^'"]+)['"]/);
      if (routeMatch) {
        const rawPath = routeMatch[1];
        const methodsMatch = text.match(/methods\s*=\s*\[([^\]]+)\]/);
        const methods = methodsMatch
          ? methodsMatch[1].split(',').map(m => m.trim().replace(/['"]/g, '').toUpperCase())
          : ['GET'];
        for (const method of methods) {
          endpoints.push({
            method,
            url_pattern: normalizePath(rawPath),
            file: filePath,
            line: node.startPosition.row + 1,
            lang: 'py',
            framework: 'flask',
            auth: text.toLowerCase().includes('login_required') ? 'session' : 'none',
            confidence: 1.0,
            kind: 'route',
          });
        }
      }

      // @app.get|post|put|delete|patch('/path')
      const shortMatch = text.match(/@\w+\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/i);
      if (shortMatch && !routeMatch) {
        endpoints.push({
          method: shortMatch[1].toUpperCase(),
          url_pattern: normalizePath(shortMatch[2]),
          file: filePath,
          line: node.startPosition.row + 1,
          lang: 'py',
          framework: 'fastapi',
          auth: 'none',
          confidence: 1.0,
          kind: 'route',
        });
      }
    }

    // requests/httpx client calls
    if (node.type === 'call') {
      const fnText = node.childForFieldName
        ? (node.childForFieldName('function') || { text: '' }).text
        : '';
      const clientMatch = fnText.match(/(?:requests|httpx|session)\.(get|post|put|delete|patch|head|request)$/i);
      if (clientMatch) {
        const args = node.childForFieldName ? node.childForFieldName('arguments') : null;
        if (args && args.namedChildCount >= 1) {
          const urlNode = args.namedChild(0);
          const rawUrl = stringValue(urlNode);
          if (rawUrl) {
            endpoints.push({
              method: clientMatch[1].toUpperCase(),
              url_pattern: normalizePath(rawUrl),
              file: filePath,
              line: node.startPosition.row + 1,
              lang: 'py',
              framework: 'flask',
              auth: 'none',
              confidence: 0.7,
              kind: 'client_call',
            });
          }
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      visitNode(node.child(i));
    }
  }

  visitNode(tree.rootNode);
  return endpoints;
}

function detectBaseURL(tree) {
  const text = tree.rootNode.text;
  const match = text.match(/(?:BASE_URL|base_url|API_URL)\s*=\s*['"]([^'"]+)['"]/);
  if (match) return match[1];
  return null;
}

module.exports = { id, extensions, frameworks, extract, detectBaseURL };
