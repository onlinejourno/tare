'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert');
const { main } = require('./operatorRun');
const { hostHeaders } = require('./hostHeaders');

const TOKEN = { 'X-Site-Key': 'k-1' };
const ORIGINAL = process.env.FETCH_HOST_HEADERS;
after(() => {
  if (ORIGINAL === undefined) delete process.env.FETCH_HOST_HEADERS;
  else process.env.FETCH_HOST_HEADERS = ORIGINAL;
});

const quiet = { log: () => {}, error: () => {} };
const deps = (over) => ({
  validate: async (u) => u,
  analyze: async () => ({ pageWeight: {} }),
  assemble: (raw) => raw,
  save: async () => {},
  ...quiet,
  ...over,
});

test('an operator run sends the headers and stores the run', async () => {
  process.env.FETCH_HOST_HEADERS = JSON.stringify({ 'news.example': TOKEN });
  let sent, saved;
  const code = await main(['https://news.example/'], deps({
    analyze: async (url) => { sent = hostHeaders(url); return {}; },
    save: async (...args) => { saved = args.slice(1, 3); },
  }));
  assert.deepStrictEqual([code, sent, saved], [0, TOKEN, ['https://news.example/', 'headless']]);
});

test('a refused URL exits 2 without running', async () => {
  let ran = false;
  const code = await main(['http://127.0.0.1/'], deps({
    validate: async () => { throw new Error('Private/local network URLs are not allowed.'); },
    analyze: async () => { ran = true; return {}; },
  }));
  assert.deepStrictEqual([code, ran], [2, false]);
});

test('a failed store exits 1, never swallowed', async () => {
  const code = await main(['https://news.example/'], deps({
    save: async () => { throw new Error('db down'); },
  }));
  assert.strictEqual(code, 1);
});
