// lib/langs/javascript.js
// Extract Express/Fastify routes and axios/fetch client calls from JS/TS ASTs.
// Works for both .js/.jsx/.mjs and (when loaded as typescript) .ts/.tsx.

'use strict';

const id = 'javascript';
const extensions = ['.js', '.jsx', '.mjs'];
const frameworks = ['express', 'fastify'];

/**
 * Normalise Express-style :param to {param}.
 */
function normalizePath(p) {
  if (!p) return p;
  // :param -> {param}
  return p.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');
}

/**
 * Extract a string literal value from a tree-sitter node.
 * Returns null if the node is not a plain string.
 */
function stringValue(node) {
  if (!node) return null;
  if (node.type === 'string') {
    // Grab inner text — strip surrounding quotes
    const raw = node.text;
    return raw.slice(1, raw.length - 1);
  }
  if (node.type === 'template_string') {
    // Only handle simple template literals with no expressions
    const raw = node.text;
    if (!raw.includes('${')) {
      return raw.slice(1, raw.length - 1);
    }
    // Has expressions — return partially resolved
    return raw.slice(1, raw.length - 1); // keep raw, confidence drops
  }
  return null;
}

/**
 * Walk every call_expression in the tree and collect routes/client calls.
 */
function extract(tree, filePath) {
  const endpoints = [];
  const cursor = tree.walk();

  const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'all']);
  const CLIENT_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'request']);

  function visitNode(node) {
    if (node.type === 'call_expression') {
      const fnNode = node.childForFieldName('function');
      if (fnNode) {
        const fnText = fnNode.text;

        // Express/Fastify route: app.get('/path', handler) / router.post('/path', handler)
        const routeMatch = fnText.match(/^(?:app|router|r)\.(get|post|put|delete|patch|head|options|all)$/i);
        if (routeMatch) {
          const method = routeMatch[1].toUpperCase();
          const args = node.childForFieldName('arguments');
          if (args && args.namedChildCount >= 1) {
            const pathNode = args.namedChild(0);
            const rawPath = stringValue(pathNode);
            if (rawPath) {
              const confidence = pathNode.type === 'template_string' && rawPath.includes('${') ? 0.7 : 1.0;
              endpoints.push({
                method,
                url_pattern: normalizePath(rawPath),
                file: filePath,
                line: node.startPosition.row + 1,
                lang: 'js',
                framework: 'express',
                auth: 'none',
                confidence,
                kind: 'route',
              });
            }
          }
        }

        // app.route('/path').get(handler).post(handler)
        if (fnText.match(/^(?:app|router)\.(route)$/i)) {
          const args = node.childForFieldName('arguments');
          if (args && args.namedChildCount >= 1) {
            const pathNode = args.namedChild(0);
            const rawPath = stringValue(pathNode);
            if (rawPath) {
              // The chained methods will be picked up by the call_expression visitor
              // separately; just capture the route definition here
              endpoints.push({
                method: 'ANY',
                url_pattern: normalizePath(rawPath),
                file: filePath,
                line: node.startPosition.row + 1,
                lang: 'js',
                framework: 'express',
                auth: 'none',
                confidence: 1.0,
                kind: 'route',
              });
            }
          }
        }

        // axios client calls: axios.get/post/... or client.get/...
        const axiosMatch = fnText.match(/(?:axios|client|http)\.(get|post|put|delete|patch|head|request)$/i);
        if (axiosMatch) {
          const method = axiosMatch[1].toUpperCase();
          const args = node.childForFieldName('arguments');
          if (args && args.namedChildCount >= 1) {
            const urlNode = args.namedChild(0);
            const rawUrl = stringValue(urlNode);
            if (rawUrl) {
              endpoints.push({
                method,
                url_pattern: normalizePath(rawUrl),
                file: filePath,
                line: node.startPosition.row + 1,
                lang: 'js',
                framework: 'express',
                auth: 'none',
                confidence: rawUrl.startsWith('http') ? 0.7 : 1.0,
                kind: 'client_call',
              });
            }
          }
        }

        // fetch() client call
        if (fnText === 'fetch') {
          const args = node.childForFieldName('arguments');
          if (args && args.namedChildCount >= 1) {
            const urlNode = args.namedChild(0);
            const rawUrl = stringValue(urlNode);
            if (rawUrl) {
              // Try to get method from options second arg
              let method = 'GET';
              if (args.namedChildCount >= 2) {
                const opts = args.namedChild(1);
                if (opts) {
                  const text = opts.text;
                  const m = text.match(/method\s*:\s*['"]([A-Z]+)['"]/i);
                  if (m) method = m[1].toUpperCase();
                }
              }
              endpoints.push({
                method,
                url_pattern: normalizePath(rawUrl),
                file: filePath,
                line: node.startPosition.row + 1,
                lang: 'js',
                framework: 'express',
                auth: 'none',
                confidence: 0.7,
                kind: 'client_call',
              });
            }
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

/**
 * Detect base URL from axios.defaults.baseURL or app.listen() port.
 */
function detectBaseURL(tree) {
  const rootText = tree.rootNode.text;
  // axios.defaults.baseURL = 'http://...'
  const axiosMatch = rootText.match(/axios\.defaults\.baseURL\s*=\s*['"`]([^'"`]+)['"`]/);
  if (axiosMatch) return axiosMatch[1];

  // const BASE_URL = 'http://...'
  const constMatch = rootText.match(/(?:const|let|var)\s+(?:BASE_URL|baseURL|BASE)\s*=\s*['"`]([^'"`]+)['"`]/);
  if (constMatch) return constMatch[1];

  // app.listen(PORT) — return localhost
  const listenMatch = rootText.match(/app\.listen\(\s*(\d+)/);
  if (listenMatch) return `http://localhost:${listenMatch[1]}`;

  return null;
}

module.exports = { id, extensions, frameworks, extract, detectBaseURL };
