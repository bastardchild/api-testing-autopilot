const { URL } = require('url');
const fs = require('fs');
const path = require('path');

const WHITELIST_PATH = path.join(process.cwd(), 'configs', 'whitelist.json');
const whitelist = JSON.parse(fs.readFileSync(WHITELIST_PATH, 'utf8'));

function checkWhitelist(targetUrl) {
  let host;
  try { host = new URL(targetUrl).hostname; } catch (e) {
    return { allowed: false, reason: 'Invalid URL: ' + targetUrl };
  }
  if (whitelist.includes(host)) return { allowed: true };
  return { allowed: false, reason: 'Host ' + host + ' is not in the whitelist' };
}

console.log('localhost:3000:', JSON.stringify(checkWhitelist('http://localhost:3000')));
console.log('127.0.0.1:3000:', JSON.stringify(checkWhitelist('http://127.0.0.1:3000')));
console.log('example.com:', JSON.stringify(checkWhitelist('https://example.com')));
console.log('api.stripe.com:', JSON.stringify(checkWhitelist('https://api.stripe.com/v1/charges')));
