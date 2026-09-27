const fs = require('fs');
const script = fs.readFileSync('results/demo-script.js', 'utf8');
const checks = [
  ['has k6/http import', script.includes("import http from 'k6/http'")],
  ['has sleep import', script.includes("import { sleep } from 'k6'")],
  ['has export options', script.includes('export const options')],
  ['has vus: 10', script.includes('vus: 10')],
  ['has duration 30s', script.includes("duration: '30s'")],
  ['has thresholds', script.includes('thresholds')],
  ['has default export', script.includes('export default function')],
  ['has http calls', script.includes('http.get') || script.includes('http.post')],
  ['has sleep()', script.includes('sleep(')],
];
checks.forEach(function(c) { console.log((c[1] ? 'PASS' : 'FAIL') + ' - ' + c[0]); });
const allPass = checks.every(function(c) { return c[1]; });
console.log('');
console.log(allPass ? 'PHASE 3 GATE: PASS' : 'PHASE 3 GATE: FAIL');
