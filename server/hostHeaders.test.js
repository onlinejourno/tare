'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { hostHeaders, continueWithHostHeaders } = require('./hostHeaders');

const TOKEN = { 'CF-Access-Client-Id': 'id-1', 'CF-Access-Client-Secret': 's-1' };
const ORIGINAL = process.env.FETCH_HOST_HEADERS;
after(() => {
  if (ORIGINAL === undefined) delete process.env.FETCH_HOST_HEADERS;
  else process.env.FETCH_HOST_HEADERS = ORIGINAL;
});

function set(table) { process.env.FETCH_HOST_HEADERS = JSON.stringify(table); }

test('no setting means no extra headers', () => {
  delete process.env.FETCH_HOST_HEADERS;
  assert.deepStrictEqual(hostHeaders('https://news.example/a'), {});
});

test('host and subdomains match, lookalikes do not', () => {
  set({ 'news.example': TOKEN });
  assert.deepStrictEqual(hostHeaders('https://news.example/a'), TOKEN);
  assert.deepStrictEqual(hostHeaders('https://WWW.news.example/a'), TOKEN);
  assert.deepStrictEqual(hostHeaders('https://evilnews.example/a'), {});
  assert.deepStrictEqual(hostHeaders('https://news.example.attacker.test/a'), {});
});

test('a broken setting throws', () => {
  process.env.FETCH_HOST_HEADERS = '{not json';
  assert.throws(() => hostHeaders('https://news.example/a'), /FETCH_HOST_HEADERS/);
  set({ 'news.example': ['x'] });
  assert.throws(() => hostHeaders('https://news.example/a'), /FETCH_HOST_HEADERS/);
});

test('a route adds the token only for its host', async () => {
  set({ 'news.example': TOKEN });
  const calls = [];
  const route = (url) => ({
    request: () => ({ url: () => url, headers: () => ({ 'user-agent': 'UA' }) }),
    continue: (opts) => { calls.push([url, 'continue', opts]); },
    fetch: async (opts) => { calls.push([url, 'fetch', opts]); return 'RESP'; },
    fulfill: (opts) => { calls.push([url, 'fulfill', opts]); },
  });
  await continueWithHostHeaders(route('https://news.example/a'));
  await continueWithHostHeaders(route('https://tracker.example/pixel'));
  assert.deepStrictEqual(calls[0], ['https://news.example/a', 'fetch',
    { headers: { 'user-agent': 'UA', ...TOKEN }, maxRedirects: 0 }]);
  assert.deepStrictEqual(calls[1], ['https://news.example/a', 'fulfill', { response: 'RESP' }]);
  assert.deepStrictEqual(calls[2], ['https://tracker.example/pixel', 'continue', undefined]);
});

// In a real browser: the site's own page gets the token; a sub-resource on
// another host and a redirect to another host do not.
test('in Chromium the token reaches only its host', async (t) => {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch { t.skip('playwright not installed'); return; }
  const seen = [];
  const other = http.createServer((req, res) => {
    seen.push(['other', req.url, req.headers['cf-access-client-id'] || null]);
    res.end('ok');
  });
  await new Promise(r => other.listen(0, r));
  const op = other.address().port;
  const site = http.createServer((req, res) => {
    seen.push(['site', req.url, req.headers['cf-access-client-id'] || null]);
    if (req.url === '/go') { res.writeHead(302, { Location: `http://localhost:${op}/landed` }); return res.end(); }
    res.setHeader('content-type', 'text/html');
    res.end(`<img src="http://localhost:${op}/pixel.gif">`);
  });
  await new Promise(r => site.listen(0, '127.0.0.1', r));
  const sp = site.address().port;
  set({ '127.0.0.1': TOKEN });
  let browser;
  // Test-only: Chromium's local-network check treats a fulfilled page as public
  // and blocks its loopback sub-resources; real sites are public to public.
  try {
    browser = await chromium.launch({ headless: true, args: [
      '--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,BlockInsecurePrivateNetworkRequests',
    ] });
  }
  catch (e) { other.close(); site.close(); t.skip(`chromium not available: ${e.message.split('\n')[0]}`); return; }
  try {
    const context = await browser.newContext();
    await context.route('**', continueWithHostHeaders);
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${sp}/`, { waitUntil: 'load' });
    await page.goto(`http://127.0.0.1:${sp}/go`, { waitUntil: 'load' });
  } finally {
    await browser.close(); other.close(); site.close();
  }
  assert.deepStrictEqual(seen.filter(s => s[0] === 'site').map(s => s[2]), ['id-1', 'id-1']);
  const others = seen.filter(s => s[0] === 'other');
  assert.ok(others.some(s => s[1] === '/pixel.gif'), JSON.stringify(seen));
  assert.ok(others.some(s => s[1] === '/landed'), JSON.stringify(seen));
  for (const s of others) assert.strictEqual(s[2], null, `token leaked to ${s[1]}`);
});
