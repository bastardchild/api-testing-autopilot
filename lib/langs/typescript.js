// lib/langs/typescript.js
// TypeScript extraction — re-uses the JavaScript extractor but marks lang as 'ts'.

'use strict';

const js = require('./javascript');

const id = 'typescript';
const extensions = ['.ts', '.tsx'];
const frameworks = ['express', 'fastify'];

function extract(tree, filePath) {
  return js.extract(tree, filePath).map(ep => ({ ...ep, lang: 'ts' }));
}

function detectBaseURL(tree) {
  return js.detectBaseURL(tree);
}

module.exports = { id, extensions, frameworks, extract, detectBaseURL };
