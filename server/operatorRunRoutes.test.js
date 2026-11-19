'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test, after } = require('node:test');
const express = require('express');

const { registerOperatorRun } = require('./operatorRunRoutes');

const KEY = 'test-site-key';
const ORIGINAL = { ...process.env };
after(() => { process.env = ORIGINAL; });

// Signs like the hub: a stringer-v2 member, so `created` is signed.
function sign(method, url, body = '', key = KEY) {
  const digest = 'sha-256=' + crypto.createHash('sha256').update(body).digest('base64');
  const params = `(@method @target-uri content-digest);keyid="newsroom-v1";alg="hmac-sha256";created=${Math.floor(Date.now() / 1000)}`;
  const base = `@method: ${method}\n@target-uri: ${url}\ncontent-digest: ${digest}\n@signature-params: ${params}`;
  const sig = crypto.createHmac('sha256', key).update(base).digest('base64');
  return { 'signature-input': `stringer-v2=${params}`, signature: `stringer-v2=:${sig}:`, 'content-digest': digest };
}

// The old member alone: valid HMAC, but `created` unsigned, so replayable.
function signV1(method, url, body = '') {
  const digest = 'sha-256=' + crypto.createHash('sha256').update(body).digest('base64');
  const base = `@method: ${method}\n@target-uri: ${url}\ncontent-digest: ${digest}`;
  const sig = crypto.createHmac('sha256', KEY).update(base).digest('base64');
  return {
    'signature-input': 'stringer=(@method @target-uri content-digest);keyid="newsroom-v1";alg="hmac-sha256";created=1',
    signature: `stringer=:${sig}:`,
    'content-digest': digest,
  };
}

async function server(run, clock = { t: 0 }) {
  process.env.TARE_STRINGER_KEY = KEY;
  delete process.env.TARE_STRINGER_KEY_ID;
  delete process.env.OPERATOR_RUN_COOLDOWN_MINUTES;
  process.env.FETCH_HOST_HEADERS = JSON.stringify({ 'news.example': { 'X-Site-Key': 'k' } });
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));
  registerOperatorRun(app, { limiter: (_q, _s, next) => next(), run, now: () => clock.t });
  const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const post = async (url, headers = sign) => {
    const body = JSON.stringify({ url });
    const target = `${base}/stringer/tare/operator-run`;
    const h = typeof headers === 'function' ? headers('POST', target, body) : headers;
    return fetch(target, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body });
  };
  const status = async (id, signed = true) => {
    const target = `${base}/stringer/tare/operator-run/${id}`;
    return fetch(target, { headers: signed ? sign('GET', target) : {} });
  };
  return { post, status, close: () => srv.close() };
}

const settle = () => new Promise(r => setImmediate(r));

test('an unsigned request is refused and runs nothing', async () => {
  let ran = false;
  const s = await server(async () => { ran = true; });
  try {
    const res = await s.post('https://news.example/', {});
    assert.deepEqual([res.status, ran], [401, false]);
  } finally { s.close(); }
});

test('a signature without a signed created is refused', async () => {
  let ran = false;
  const s = await server(async () => { ran = true; });
  try {
    const res = await s.post('https://news.example/', signV1);
    assert.deepEqual([res.status, ran], [401, false]);
  } finally { s.close(); }
});

test('a host with no door is refused and runs nothing', async () => {
  let ran = false;
  const s = await server(async () => { ran = true; });
  try {
    const res = await s.post('https://elsewhere.example/');
    assert.deepEqual([res.status, ran], [400, false]);
  } finally { s.close(); }
});

test('a signed run on a configured host starts and reports stored', async () => {
  const seen = [];
  const s = await server(async (url) => { seen.push(url); return 'stored https://news.example/ as run r1'; });
  try {
    const res = await s.post('https://news.example/');
    const { id } = await res.json();
    await settle();
    const st = await (await s.status(id)).json();
    assert.deepEqual([res.status, seen, st.state, st.message], [202, ['https://news.example/'], 'stored', 'stored https://news.example/ as run r1']);
  } finally { s.close(); }
});

test('a failed run reports failed with the reason, never running forever', async () => {
  const s = await server(async () => { throw new Error('failed: db down'); });
  try {
    const { id } = await (await s.post('https://news.example/')).json();
    await settle();
    const st = await (await s.status(id)).json();
    assert.deepEqual([st.state, st.message], ['failed', 'failed: db down']);
  } finally { s.close(); }
});

test('one run at a time', async () => {
  let release;
  const s = await server(() => new Promise(r => { release = r; }));
  try {
    await s.post('https://news.example/');
    const second = await s.post('https://news.example/');
    release('stored');
    assert.equal(second.status, 409);
  } finally { s.close(); }
});

test('a second run inside ten minutes is refused, and allowed after', async () => {
  const clock = { t: 0 };
  const s = await server(async () => 'stored', clock);
  try {
    await s.post('https://news.example/');
    await settle();
    clock.t = 9 * 60_000;
    const early = await s.post('https://news.example/');
    clock.t = 10 * 60_000;
    const later = await s.post('https://news.example/');
    assert.deepEqual([early.status, early.headers.get('retry-after'), later.status], [429, '60', 202]);
  } finally { s.close(); }
});

test('status needs a signature and a known id', async () => {
  const s = await server(async () => 'stored');
  try {
    const { id } = await (await s.post('https://news.example/')).json();
    const unsigned = await s.status(id, false);
    const unknown = await s.status('nope');
    assert.deepEqual([unsigned.status, unknown.status], [401, 404]);
  } finally { s.close(); }
});
