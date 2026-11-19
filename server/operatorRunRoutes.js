'use strict';

// POST /stringer/tare/operator-run       start an operator run (signed)
// GET  /stringer/tare/operator-run/:id   how that run is going (signed)
//
// Lets the hub start what `node server/operatorRun.js` does, so an
// admin presses a button instead of opening a shell. The run sends the site's
// FETCH_HOST_HEADERS, so every guard here is about who may open that door:
//
//   - The hub's signature, with a signed `created` (stringer-v2) so a captured
//     request cannot be replayed. The old member alone is refused here.
//   - The host must be one FETCH_HOST_HEADERS names. The request picks the URL
//     but never widens the table, even with the hub's key in hand.
//   - One run at a time, and none within the cooldown of the last start: each
//     run drives a headless browser.
//
// Nothing the run reads comes back here: the result is stored like any run and
// read through the signed `latest` endpoint. Status says only stored or failed
// and why. Runs live in memory: a restart ends any run in flight, and the
// cooldown restarts with it.

const crypto = require('crypto');
const { targetUriFor, verifyStringerSignature } = require('./stringerAuth');
const { hostHeaders, operatorDoor } = require('./hostHeaders');

const COOLDOWN_ENV = 'OPERATOR_RUN_COOLDOWN_MINUTES';
const DEFAULT_COOLDOWN_MINUTES = 10;
const MS_PER_MINUTE = 60_000;

function cooldownMs() {
  const raw = process.env[COOLDOWN_ENV];
  const minutes = raw === undefined || raw.trim() === '' ? DEFAULT_COOLDOWN_MINUTES : Number(raw);
  if (!Number.isFinite(minutes) || minutes < 0) throw new Error(`${COOLDOWN_ENV} must be a number of minutes`);
  return minutes * MS_PER_MINUTE;
}

function signedV2(req, body) {
  if (!/(?:^|,\s*)stringer-v2=/.test(req.headers['signature-input'] || '')) return false;
  return verifyStringerSignature(
    req.method,
    targetUriFor(req),
    body,
    req.headers,
    process.env.TARE_STRINGER_KEY || '',
    undefined,
    process.env.TARE_STRINGER_KEY_ID,
  );
}

// The run `node server/operatorRun.js <url>` does, reporting its last line.
async function defaultRun(url) {
  const { main, DEFAULTS } = require('./operatorRun');
  const lines = [];
  const say = (msg) => lines.push(String(msg));
  const code = await main([url], { ...DEFAULTS, log: say, error: say });
  const last = lines[lines.length - 1] || `exit ${code}`;
  if (code !== 0) throw new Error(last);
  return last;
}

function registerOperatorRun(app, { limiter, statusLimiter = limiter, run = defaultRun, now = Date.now }) {
  const runs = new Map();
  let lastStart = null;
  let inFlight = false;

  app.post('/stringer/tare/operator-run', limiter, (req, res) => {
    if (!signedV2(req, req.rawBody ?? '')) return res.status(401).json({ error: 'unauthorized' });

    const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    let opened;
    try { opened = operatorDoor(() => hostHeaders(url)); }
    catch (err) { return res.status(500).json({ error: err.message }); }
    if (Object.keys(opened).length === 0) {
      return res.status(400).json({ error: 'Tare has no key for that site.' });
    }

    if (inFlight) return res.status(409).json({ error: 'A run is already going. Wait for it to finish.' });
    let wait;
    try { wait = lastStart === null ? 0 : lastStart + cooldownMs() - now(); }
    catch (err) { return res.status(500).json({ error: err.message }); }
    if (wait > 0) {
      res.set('Retry-After', String(Math.ceil(wait / 1000)));
      return res.status(429).json({ error: `Checked recently. Try again in ${Math.ceil(wait / MS_PER_MINUTE)} minutes.` });
    }

    const id = crypto.randomUUID();
    const entry = { state: 'running', startedAt: new Date(now()).toISOString(), finishedAt: null, message: null };
    runs.set(id, entry);
    lastStart = now();
    inFlight = true;
    Promise.resolve()
      .then(() => run(url))
      .then(
        (message) => Object.assign(entry, { state: 'stored', message: message ?? null }),
        (err) => Object.assign(entry, { state: 'failed', message: err?.message || String(err) }),
      )
      .finally(() => {
        entry.finishedAt = new Date(now()).toISOString();
        inFlight = false;
        if (entry.state === 'failed') console.error('[operator-run] failed:', entry.message);
      });
    return res.status(202).json({ id });
  });

  app.get('/stringer/tare/operator-run/:id', statusLimiter, (req, res) => {
    if (!signedV2(req, '')) return res.status(401).json({ error: 'unauthorized' });
    const entry = runs.get(req.params.id);
    if (!entry) return res.status(404).json({ error: 'No such run.' });
    return res.json(entry);
  });
}

module.exports = { registerOperatorRun };
