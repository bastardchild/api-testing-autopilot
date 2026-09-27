// lib/langs/registry.js
// Manifest of supported languages: extensions, WASM grammar filename,
// lazy loader for the lang module. Do NOT import grammars here eagerly.

'use strict';

const REGISTRY = {
  javascript: {
    ext: ['.js', '.jsx', '.mjs'],
    wasm: 'tree-sitter-javascript.wasm',
    load: () => require('./javascript'),
  },
  typescript: {
    ext: ['.ts', '.tsx'],
    wasm: 'tree-sitter-typescript.wasm',
    load: () => require('./typescript'),
  },
  python: {
    ext: ['.py'],
    wasm: 'tree-sitter-python.wasm',
    load: () => require('./python'),
  },
  go: {
    ext: ['.go'],
    wasm: 'tree-sitter-go.wasm',
    load: () => require('./go'),
  },
};

module.exports = REGISTRY;
