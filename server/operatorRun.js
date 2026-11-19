'use strict';

// Run Tare on one site as the operator, with the site's door open.
//
//     node server/operatorRun.js https://news.example
//
// The only path that sends FETCH_HOST_HEADERS (see hostHeaders.operatorDoor).
// Run it on the Tare machine (`fly ssh console`), where the secret lives. The
// run is stored like a public one, so the site's history and the hub's signed
// endpoint read it.
//
// Exit codes: 0 stored, 1 analysis or store failed, 2 URL refused. Every
// failure prints why; nothing here is swallowed.

const { v4: uuidv4 } = require('uuid');
const { operatorDoor } = require('./hostHeaders');

// Required on use, not at load: the tests swap them out, and ./db refuses to
// load without DATABASE_URL.
const DEFAULTS = {
  validate: (url) => require('./ssrfGuard').validateUrl(url),
  analyze:  (url, progress) => require('./analyzer').analyzeUrl(url, progress),
  assemble: (raw) => require('./analysisResult').assembleAnalysisResult(raw, { mode: 'headless' }),
  save:     (...args) => require('./db').saveAnalysis(...args),
  log:      (msg) => console.log(msg),
  error:    (msg) => console.error(msg),
};

async function main(argv, deps = DEFAULTS) {
  const { validate, analyze, assemble, save, log, error } = deps;
  if (argv.length !== 1) {
    error('usage: node server/operatorRun.js <site-url>');
    return 2;
  }
  let url = argv[0].trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try {
    url = await validate(url);
  } catch (err) {
    error(`refused: ${err.message}`);
    return 2;
  }

  const runId = uuidv4();
  try {
    const raw = await operatorDoor(() => analyze(url, (stage, percent) => error(`${stage} ${percent}%`)));
    const result = assemble(raw);
    await save(runId, url, 'headless', result, !!(raw.accessBlocked?.blocked));
    log(`stored ${url} as run ${runId}${raw.accessBlocked?.blocked ? ' (the site blocked Tare)' : ''}`);
    return 0;
  } catch (err) {
    error(`failed: ${err.message}`);
    return 1;
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}

module.exports = { main, DEFAULTS };
