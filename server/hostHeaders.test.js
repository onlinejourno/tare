'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { hostHeaders, operatorDoor, hostHeaderRoute } = require('./hostHeaders');

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

test('host and subdomains match, lookalikes do not', () => operatorDoor(() => {
  set({ 'news.example': TOKEN });
  assert.deepStrictEqual(hostHeaders('https://news.example/a'), TOKEN);
  assert.deepStrictEqual(hostHeaders('https://WWW.news.example/a'), TOKEN);
  assert.deepStrictEqual(hostHeaders('https://evilnews.example/a'), {});
  assert.deepStrictEqual(hostHeaders('https://news.example.attacker.test/a'), {});
}));

test('a broken setting throws', () => operatorDoor(() => {
  process.env.FETCH_HOST_HEADERS = '{not json';
  assert.throws(() => hostHeaders('https://news.example/a'), /FETCH_HOST_HEADERS/);
  set({ 'news.example': ['x'] });
  assert.throws(() => hostHeaders('https://news.example/a'), /FETCH_HOST_HEADERS/);
}));

// The headers can be a secret that lets Tare past a site's block. POST
// /api/analyze runs any site for anyone and returns what it saw, so a public
// run must never send them.
test('a public run on a configured host sends nothing', () => {
  set({ 'news.example': TOKEN });
  assert.deepStrictEqual(hostHeaders('https://news.example/a'), {});
});

test('an operator run sends the headers, and only while it lasts', async () => {
  set({ 'news.example': TOKEN });
  const inside = await operatorDoor(async () => { await null; return hostHeaders('https://news.example/a'); });
  assert.deepStrictEqual([inside, hostHeaders('https://news.example/a')], [TOKEN, {}]);
});

test('a public run never inherits an open door', async () => {
  set({ 'news.example': TOKEN });
  let release;
  const gate = new Promise(r => { release = r; });
  const publicRun = (async () => { await gate; return hostHeaders('https://news.example/a'); })();
  await operatorDoor(async () => { release(); await publicRun; });
  assert.deepStrictEqual(await publicRun, {});
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
  const withHostHeaders = operatorDoor(hostHeaderRoute);
  await withHostHeaders(route('https://news.example/a'));
  await withHostHeaders(route('https://tracker.example/pixel'));
  assert.deepStrictEqual(calls[0], ['https://news.example/a', 'fetch',
    { headers: { 'user-agent': 'UA', ...TOKEN }, maxRedirects: 0 }]);
  assert.deepStrictEqual(calls[1], ['https://news.example/a', 'fulfill', { response: 'RESP' }]);
  assert.deepStrictEqual(calls[2], ['https://tracker.example/pixel', 'continue', undefined]);
});

// In a real browser: an operator run gives the site's own page the token; a
// sub-resource on another host and a redirect to another host do not. A
// public run in the same browser, after the operator run, sends nothing:
// Playwright fires route handlers from its own connection, not the caller's
// async context, so the door is fixed when the route is made.
test('in Chromium the token reaches only its host, and only on an operator run', async (t) => {
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
  const visit = async () => {
    const context = await browser.newContext();
    await context.route('**', hostHeaderRoute());
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${sp}/`, { waitUntil: 'load' });
    await page.goto(`http://127.0.0.1:${sp}/go`, { waitUntil: 'load' });
    await context.close();
  };
  let operatorSeen;
  try {
    await operatorDoor(visit);
    operatorSeen = seen.splice(0);
    await visit();
  } finally {
    await browser.close(); other.close(); site.close();
  }
  assert.deepStrictEqual(seen.filter(s => s[2] !== null), [], `public run sent the token: ${JSON.stringify(seen)}`);
  assert.deepStrictEqual(operatorSeen.filter(s => s[0] === 'site').map(s => s[2]), ['id-1', 'id-1']);
  const others = operatorSeen.filter(s => s[0] === 'other');
  assert.ok(others.some(s => s[1] === '/pixel.gif'), JSON.stringify(operatorSeen));
  assert.ok(others.some(s => s[1] === '/landed'), JSON.stringify(operatorSeen));
  for (const s of others) assert.strictEqual(s[2], null, `token leaked to ${s[1]}`);
});
