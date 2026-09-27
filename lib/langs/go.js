// lib/langs/go.js
// Extract net/http, gin, chi, gorilla routes and http client calls from Go ASTs.
// Implements: prefix tracking, method inference, const resolution, Go 1.22 patterns.

'use strict';

const id = 'go';
const extensions = ['.go'];
const frameworks = ['net-http', 'gin', 'chi', 'gorilla'];

/**
 * Normalize :param -> {param} (gorilla), {param} is already correct.
 */
function normalizePath(p) {
  if (!p) return p;
  p = p.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');
  return p;
}

/**
 * Extract the string value of a node.
 */
function stringValue(node) {
  if (!node) return null;
  const t = node.type;
  if (t === 'interpreted_string_literal' || t === 'raw_string_literal') {
    const raw = node.text;
    if (raw.startsWith('`')) return raw.slice(1, raw.length - 1);
    return raw.slice(1, raw.length - 1);
  }
  return null;
}

/**
 * Resolve simple const/var string declarations in the file.
 * Returns a map: varName -> string value.
 * Handles: const x = "val"  and  const x = prefix + "/suffix"
 * Also handles Go's expression_list wrapper around values.
 */
function resolveConsts(rootNode) {
  const consts = {};

  function extractValue(valNode) {
    if (!valNode) return null;
    // Direct string literal
    const sv = stringValue(valNode);
    if (sv !== null) return sv;
    // expression_list wraps the actual value(s)
    if (valNode.type === 'expression_list') {
      for (let i = 0; i < valNode.childCount; i++) {
        const child = valNode.child(i);
        const s = stringValue(child);
        if (s !== null) return s;
        if (child.type === 'binary_expression') {
          const r = resolveBinary(child, consts);
          if (r !== null) return r;
        }
        if (child.type === 'identifier' && consts[child.text] !== undefined) {
          return consts[child.text];
        }
      }
    }
    if (valNode.type === 'binary_expression') {
      return resolveBinary(valNode, consts);
    }
    return null;
  }

  function visit(node) {
    // const identifier = "value"   or   var identifier = "value"
    if (node.type === 'const_spec' || node.type === 'var_spec') {
      const nameNode = node.namedChild(0);
      const valNode = node.namedChild(1);
      if (nameNode) {
        const val = extractValue(valNode);
        if (val !== null) {
          consts[nameNode.text] = val;
        }
      }
    }
    for (let i = 0; i < node.childCount; i++) visit(node.child(i));
  }
  visit(rootNode);
  return consts;
}

function resolveBinary(node, consts) {
  if (!node) return null;
  const t = node.type;
  if (t === 'interpreted_string_literal' || t === 'raw_string_literal') return stringValue(node);
  if (t === 'identifier') return consts[node.text] || null;
  if (t === 'binary_expression') {
    const op = node.child(1);
    if (op && op.text === '+') {
      const left = resolveBinary(node.namedChild(0), consts);
      const right = resolveBinary(node.namedChild(1), consts);
      if (left !== null && right !== null) return left + right;
    }
  }
  return null;
}

/**
 * Detect framework from import paths.
 */
function detectFramework(rootNode) {
  const text = rootNode.text;
  if (text.includes('"github.com/gin-gonic/gin"')) return 'gin';
  if (text.includes('"github.com/go-chi/chi"')) return 'chi';
  if (text.includes('"github.com/gorilla/mux"')) return 'gorilla';
  return 'net-http';
}

/**
 * Try to infer HTTP methods from a handler function body.
 * Looks for switch r.Method, r.Method == http.MethodXxx, case "GET":
 */
function inferMethods(handlerName, rootNode) {
  const methods = [];
  const text = rootNode.text;

  // Find switch r.Method blocks
  const switchRe = /switch\s+r\.Method\s*\{([^}]+)\}/g;
  let m;
  while ((m = switchRe.exec(text)) !== null) {
    const block = m[1];
    const cases = block.match(/case\s+"([A-Z]+)"/g) || [];
    for (const c of cases) {
      const mm = c.match(/case\s+"([A-Z]+)"/);
      if (mm) methods.push(mm[1]);
    }
    const methodConsts = block.match(/case\s+http\.Method([A-Z][a-z]+)/g) || [];
    for (const c of methodConsts) {
      const mm = c.match(/Method([A-Z][a-z]+)/);
      if (mm) methods.push(mm[1].toUpperCase());
    }
  }

  // r.Method == http.MethodPost
  const eqRe = /r\.Method\s*==\s*http\.Method([A-Z][a-z]+)/g;
  while ((m = eqRe.exec(text)) !== null) {
    methods.push(m[1].toUpperCase());
  }

  return [...new Set(methods)];
}

/**
 * Main extraction function.
 */
function extract(tree, filePath) {
  const endpoints = [];
  const rootNode = tree.rootNode;
  const consts = resolveConsts(rootNode);
  const framework = detectFramework(rootNode);

  function resolveArg(node) {
    if (!node) return null;
    const sv = stringValue(node);
    if (sv !== null) return sv;
    if (node.type === 'identifier' && consts[node.text]) return consts[node.text];
    if (node.type === 'binary_expression') return resolveBinary(node, consts);
    return null;
  }

  function visitNode(node) {
    if (node.type === 'call_expression') {
      const fnNode = node.childForFieldName('function');
      if (!fnNode) { visitChildren(node); return; }

      const fnText = fnNode.text;
      const args = node.childForFieldName('arguments');

      // Go 1.22 net/http: mux.HandleFunc("GET /api/v1/users/{id}", handler)
      // Legacy net/http:  mux.HandleFunc("/api/v1/health", handler)
      // http.HandleFunc("...", handler)
      if (fnText.match(/\.(HandleFunc|Handle)$/) || fnText === 'http.HandleFunc') {
        if (args && args.namedChildCount >= 1) {
          const patNode = args.namedChild(0);
          const raw = resolveArg(patNode);
          if (raw) {
            // Go 1.22: "GET /path" or "POST /path"
            const go122 = raw.match(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\/\S*)$/);
            if (go122) {
              endpoints.push({
                method: go122[1],
                url_pattern: normalizePath(go122[2]),
                file: filePath,
                line: node.startPosition.row + 1,
                lang: 'go',
                framework,
                auth: 'none',
                confidence: 1.0,
                kind: 'route',
              });
            } else if (raw.startsWith('/')) {
              // Legacy — try method inference from handler
              const handlerNode = args.namedChildCount >= 2 ? args.namedChild(1) : null;
              const handlerName = handlerNode ? handlerNode.text : '';
              const inferredMethods = inferMethods(handlerName, rootNode);
              const methods = inferredMethods.length > 0 ? inferredMethods : ['ANY'];
              const confidence = inferredMethods.length > 0 ? 0.5 : 0.5;
              for (const method of methods) {
                endpoints.push({
                  method,
                  url_pattern: normalizePath(raw),
                  file: filePath,
                  line: node.startPosition.row + 1,
                  lang: 'go',
                  framework,
                  auth: 'none',
                  confidence,
                  kind: 'route',
                });
              }
            }
          }
        }
      }

      // Gin: r.GET("/path", handler) / r.POST / r.PUT / r.DELETE / r.PATCH
      const ginMatch = fnText.match(/\.(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)$/);
      if (ginMatch && framework === 'gin') {
        if (args && args.namedChildCount >= 1) {
          const pathNode = args.namedChild(0);
          const raw = resolveArg(pathNode);
          if (raw) {
            endpoints.push({
              method: ginMatch[1],
              url_pattern: normalizePath(raw),
              file: filePath,
              line: node.startPosition.row + 1,
              lang: 'go',
              framework: 'gin',
              auth: 'none',
              confidence: 1.0,
              kind: 'route',
            });
          }
        }
      }

      // Chi: r.Get|Post|Put|Delete|Patch(path, handler)
      const chiMatch = fnText.match(/\.(Get|Post|Put|Delete|Patch|Head|Options)$/);
      if (chiMatch && framework === 'chi') {
        if (args && args.namedChildCount >= 1) {
          const pathNode = args.namedChild(0);
          const raw = resolveArg(pathNode);
          if (raw) {
            endpoints.push({
              method: chiMatch[1].toUpperCase(),
              url_pattern: normalizePath(raw),
              file: filePath,
              line: node.startPosition.row + 1,
              lang: 'go',
              framework: 'chi',
              auth: 'none',
              confidence: 1.0,
              kind: 'route',
            });
          }
        }
      }

      // Gorilla: r.HandleFunc(path, h).Methods("GET")
      // Handled by parent call — look for .Methods chaining
      if (fnText.match(/\.Methods$/)) {
        // Find the inner HandleFunc call
        const receiver = fnNode.namedChild ? fnNode.namedChild(0) : null;
        if (receiver && receiver.type === 'call_expression') {
          const innerFn = receiver.childForFieldName('function');
          if (innerFn && innerFn.text.match(/\.HandleFunc$/)) {
            const innerArgs = receiver.childForFieldName('arguments');
            if (innerArgs && innerArgs.namedChildCount >= 1) {
              const pathNode = innerArgs.namedChild(0);
              const raw = resolveArg(pathNode);
              if (raw) {
                const methodArgs = args;
                const method = methodArgs && methodArgs.namedChildCount >= 1
                  ? (stringValue(methodArgs.namedChild(0)) || 'ANY').toUpperCase()
                  : 'ANY';
                endpoints.push({
                  method,
                  url_pattern: normalizePath(raw),
                  file: filePath,
                  line: node.startPosition.row + 1,
                  lang: 'go',
                  framework: 'gorilla',
                  auth: 'none',
                  confidence: 1.0,
                  kind: 'route',
                });
              }
            }
          }
        }
      }

      // http.NewRequest(method, url, body)
      if (fnText === 'http.NewRequest' || fnText === 'http.NewRequestWithContext') {
        const offset = fnText === 'http.NewRequestWithContext' ? 1 : 0;
        if (args && args.namedChildCount >= 2 + offset) {
          const methodNode = args.namedChild(0 + offset);
          const urlNode = args.namedChild(1 + offset);
          let method = resolveArg(methodNode) || 'ANY';
          // http.MethodGet -> GET
          method = method.replace(/^http\.Method/, '').toUpperCase();
          const rawUrl = resolveArg(urlNode);
          if (rawUrl) {
            endpoints.push({
              method,
              url_pattern: normalizePath(rawUrl),
              file: filePath,
              line: node.startPosition.row + 1,
              lang: 'go',
              framework,
              auth: 'none',
              confidence: 0.7,
              kind: 'client_call',
            });
          }
        }
      }

      // http.Get(url), http.Post(url, ...)
      const httpClientMatch = fnText.match(/^http\.(Get|Post|Head)$/);
      if (httpClientMatch) {
        if (args && args.namedChildCount >= 1) {
          const urlNode = args.namedChild(0);
          const rawUrl = resolveArg(urlNode);
          if (rawUrl) {
            endpoints.push({
              method: httpClientMatch[1].toUpperCase(),
              url_pattern: normalizePath(rawUrl),
              file: filePath,
              line: node.startPosition.row + 1,
              lang: 'go',
              framework,
              auth: 'none',
              confidence: 0.7,
              kind: 'client_call',
            });
          }
        }
      }
    }

    visitChildren(node);
  }

  function visitChildren(node) {
    for (let i = 0; i < node.childCount; i++) visitNode(node.child(i));
  }

  visitNode(rootNode);

  // Deduplicate routes registered as const concatenation (e.g., "GET "+base)
  // The resolveArg already handles these — just ensure no double entries
  const seen = new Set();
  return endpoints.filter(ep => {
    const key = `${ep.method}:${ep.url_pattern}:${ep.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function detectBaseURL(tree) {
  const text = tree.rootNode.text;
  // const apiBase = "http://localhost:8080"
  const match = text.match(/(?:const|var)\s+\w*[Bb]ase\w*\s*=\s*"([^"]+)"/);
  if (match) return match[1];
  // http.ListenAndServe(":8080", ...)
  const serveMatch = text.match(/ListenAndServe\s*\(\s*":(\d+)"/);
  if (serveMatch) return `http://localhost:${serveMatch[1]}`;
  return null;
}

module.exports = { id, extensions, frameworks, extract, detectBaseURL };
