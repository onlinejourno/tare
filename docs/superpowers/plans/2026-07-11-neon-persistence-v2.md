# Neon Postgres Persistence Migration — v2 (rebased on main's createStore/DTO)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **Supersedes** `2026-07-10-neon-persistence.md`. That plan targeted pre-overhaul `index.js`/`db.js` and is now stale (branch `feat/neon-persistence` @ 8029db1 is 19 commits behind main). The Neon backend *logic* in that branch was verified working against real Neon (Task 8, 2026-07-11) — reuse it, but re-fit onto main's architecture as described here. Do NOT deploy or merge the old branch (it reverts the version-16 overhaul).

**Goal:** Replace ephemeral per-machine SQLite with shared Neon Postgres, WITHOUT regressing main's `createStore` factory, additive camelCase DTO, or the `db.test.js` contract.

**Architecture:** Keep main's public shape exactly — a `createStore(opts)` factory returning the 6 store methods + `close`, a lazily-bound default store in `db.js`, and `_parseRow` emitting BOTH snake_case (published OJDS contract) and camelCase (DTO). Change the backend from sync `better-sqlite3` to async `pg`. Because Postgres schema creation is async, `createStore` stays a sync factory but gains an async `init()` (creates schema); all 6 methods become async. Tests run against **pg-mem** (in-memory Postgres) injected via `createStore({ pool })`, so `npm test` stays offline.

**Tech Stack:** Node 20, `pg` (prod), `pg-mem` (dev/test), Neon, Express, Fly.

**Locked decisions:**
- Driver `pg`; Postgres-only in prod. Tests use `pg-mem` (chosen 2026-07-11).
- Preserve additive DTO — `db.test.js`'s "both key sets" contract MUST pass unchanged in intent.
- Portable DDL: use `BIGSERIAL` (NOT `GENERATED ALWAYS AS IDENTITY`) — pg-mem compatibility.
- `DATABASE_URL` = Neon **pooled** string. Loud-fail wrapper unchanged in spirit (fatal if unset unless `TARE_ALLOW_NO_DB=1`).
- Verified Neon connection available in gitignored `tare/.env` (pooled, us-east-1).

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `server/db-postgres.js` | Create | async `createStore(opts)` + `init()`, 6 async methods + `close`, additive DTO `_parseRow` |
| `server/db-sqlite.js` | Delete | Old sync SQLite backend |
| `server/db.js` | Rewrite | Loud-fail wrapper; lazy default store; export bound async methods + `init` + `createStore` |
| `server/db.test.js` | Rewrite | Same 9 assertions, async, pg-mem-injected store |
| `server/index.js` | Modify | `await` 2 persist sites; 2 routes async; `db.init()` before `app.listen` |
| `server/export.js` | Modify | `exportAll()` async; `await` 2 reads; CLI awaits |
| `package.json` | Modify | Remove `better-sqlite3`; add `pg` (dep) + `pg-mem` (devDep) |
| `Dockerfile` | Modify | Remove `python3 make g++` (line 5) |
| `.env.example` | Modify | Document `DATABASE_URL` (keep existing `PORT`) |
| `README.md` | Modify | Persistence = Neon section |

**DDL mapping (portable across Neon real-PG AND pg-mem):**

| Concern | Choice |
|---|---|
| PK | `id BIGSERIAL PRIMARY KEY` |
| bool | `cloudflare_blocked BOOLEAN NOT NULL DEFAULT FALSE` |
| json | `flags_json JSONB`, `full_result_json JSONB NOT NULL` (pass `JSON.stringify` — pg encodes into JSONB, reads back parsed) |
| upsert | `INSERT ... ON CONFLICT (run_id) DO UPDATE SET ...` |
| index | 3 `CREATE INDEX IF NOT EXISTS` (hostname, analysed_at, score_overall) |

---

## Task 1: Dependencies

**Files:** `package.json`

- [ ] **Step 1**
```bash
cd /Users/subhashrai/projects/tare
npm uninstall better-sqlite3
npm install pg@^8.13.1
npm install --save-dev pg-mem@^3.0.5
```
- [ ] **Step 2: verify**
Run: `node -e "const p=require('./package.json'); console.log('pg',p.dependencies.pg,'| bsq',p.dependencies['better-sqlite3'],'| pg-mem',p.devDependencies['pg-mem'])"`
Expected: `pg ^8.x | bsq undefined | pg-mem ^3.x`
- [ ] **Step 3: commit** `chore(db): swap better-sqlite3 → pg, add pg-mem for tests`

---

## Task 2: Postgres backend with `createStore` + DTO parity

**Files:** Create `server/db-postgres.js`

- [ ] **Step 1: write the file** (mirrors main's `db-sqlite.js` shape — same method names, same `_parseRow` DTO, async)

```javascript
'use strict';

/**
 * Neon Postgres persistence for analysis runs. Drop-in async replacement for
 * the former SQLite backend: same createStore(opts) factory, same public
 * methods, same additive DTO (_parseRow emits legacy snake_case AND camelCase).
 *
 * createStore is a sync factory (builds the pg Pool + wires methods); schema
 * creation is async via store.init(), which MUST be awaited once before use
 * (index.js awaits db.init() at boot; tests await store.init() in beforeEach).
 *
 * opts:
 *   - connectionString  Neon pooled URL (prod). Ignored if `pool` is given.
 *   - pool              an injected pg-compatible Pool (tests use pg-mem).
 */

const { Pool } = require('pg');

function createStore(opts = {}) {
  const pool = opts.pool || new Pool({
    connectionString: opts.connectionString || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30_000,
  });

  // Neon recycles idle connections; without this an idle-client error would
  // surface as an uncaught exception and crash the process. (pg-mem no-ops.)
  if (typeof pool.on === 'function') {
    pool.on('error', (err) => {
      console.error('[db] idle client error (non-fatal):', err.message);
    });
  }

  async function init() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS analyses (
        id                    BIGSERIAL PRIMARY KEY,
        run_id                TEXT    NOT NULL UNIQUE,
        hostname              TEXT    NOT NULL,
        url                   TEXT    NOT NULL,
        mode                  TEXT    NOT NULL DEFAULT 'headless',
        analysed_at           TEXT    NOT NULL,
        score_overall         INTEGER,
        score_surveillance    INTEGER,
        score_adtech          INTEGER,
        score_bloat           INTEGER,
        score_consent_paywall INTEGER,
        score_openness        INTEGER,
        score_performance     INTEGER,
        grade                 TEXT,
        cloudflare_blocked    BOOLEAN NOT NULL DEFAULT FALSE,
        flags_json            JSONB,
        full_result_json      JSONB   NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_analyses_hostname    ON analyses(hostname);
      CREATE INDEX IF NOT EXISTS idx_analyses_analysed_at ON analyses(analysed_at);
      CREATE INDEX IF NOT EXISTS idx_analyses_overall     ON analyses(score_overall);
    `);
  }

  async function saveAnalysis(runId, url, mode, result, cloudflareBlocked = false) {
    let hostname;
    try {
      hostname = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      hostname = url;
    }
    const scores = result.scores || {};
    const dims   = scores.dimensions || {};
    const flags  = scores.flags || [];

    const row = {
      run_id:                runId,
      hostname,
      url,
      mode,
      analysed_at:           new Date().toISOString(),
      score_overall:         scores.overall               ?? null,
      score_surveillance:    dims.surveillance            ?? null,
      score_adtech:          dims.adTechDepth             ?? null,
      score_bloat:           dims.pageBloat               ?? null,
      score_consent_paywall: dims.consentPaywallIntegrity ?? null,
      score_openness:        scores.openness              ?? null,
      score_performance:     dims.performance             ?? null,
      grade:                 scores.overallGrade?.grade   ?? null,
      cloudflare_blocked:    !!cloudflareBlocked,
      flags_json:            flags.map(f => ({ id: f.id, severity: f.severity, label: f.label })),
      full_result_json:      result,
    };

    await pool.query(
      `INSERT INTO analyses (
         run_id, hostname, url, mode, analysed_at,
         score_overall, score_surveillance, score_adtech, score_bloat,
         score_consent_paywall, score_openness, score_performance,
         grade, cloudflare_blocked, flags_json, full_result_json
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (run_id) DO UPDATE SET
         hostname=EXCLUDED.hostname, url=EXCLUDED.url, mode=EXCLUDED.mode,
         analysed_at=EXCLUDED.analysed_at,
         score_overall=EXCLUDED.score_overall, score_surveillance=EXCLUDED.score_surveillance,
         score_adtech=EXCLUDED.score_adtech, score_bloat=EXCLUDED.score_bloat,
         score_consent_paywall=EXCLUDED.score_consent_paywall,
         score_openness=EXCLUDED.score_openness, score_performance=EXCLUDED.score_performance,
         grade=EXCLUDED.grade, cloudflare_blocked=EXCLUDED.cloudflare_blocked,
         flags_json=EXCLUDED.flags_json, full_result_json=EXCLUDED.full_result_json`,
      [
        row.run_id, row.hostname, row.url, row.mode, row.analysed_at,
        row.score_overall, row.score_surveillance, row.score_adtech, row.score_bloat,
        row.score_consent_paywall, row.score_openness, row.score_performance,
        row.grade, row.cloudflare_blocked,
        JSON.stringify(row.flags_json), JSON.stringify(row.full_result_json),
      ]
    );
    return row;
  }

  async function getAnalysis(runId) {
    const { rows } = await pool.query('SELECT * FROM analyses WHERE run_id = $1', [runId]);
    return rows[0] ? _parseRow(rows[0]) : null;
  }

  async function getPublicationHistory(hostname) {
    const { rows } = await pool.query(
      'SELECT * FROM analyses WHERE hostname = $1 ORDER BY analysed_at DESC',
      [_normalise(hostname)]
    );
    return rows.map(_parseRow);
  }

  async function getLatestForPublication(hostname) {
    const { rows } = await pool.query(
      'SELECT * FROM analyses WHERE hostname = $1 ORDER BY analysed_at DESC LIMIT 1',
      [_normalise(hostname)]
    );
    return rows[0] ? _parseRow(rows[0]) : null;
  }

  async function listPublications() {
    const { rows } = await pool.query(`
      SELECT hostname,
             COUNT(*)         AS run_count,
             MAX(analysed_at) AS last_analysed,
             score_overall, grade
      FROM   analyses
      WHERE  analysed_at = (
        SELECT MAX(a2.analysed_at) FROM analyses a2 WHERE a2.hostname = analyses.hostname
      )
      GROUP BY hostname, score_overall, grade
      ORDER BY score_overall ASC NULLS LAST
    `);
    // Additive DTO + BIGINT run_count → Number for JSON parity.
    return rows.map(row => ({
      ...row,
      run_count:    Number(row.run_count),
      runCount:     Number(row.run_count),
      lastAnalysed: row.last_analysed,
      scoreOverall: row.score_overall,
    }));
  }

  async function listRecent(n = 20) {
    const { rows } = await pool.query(
      'SELECT * FROM analyses ORDER BY analysed_at DESC LIMIT $1',
      [n]
    );
    return rows.map(_parseRow);
  }

  return {
    init,
    saveAnalysis,
    getAnalysis,
    getPublicationHistory,
    getLatestForPublication,
    listPublications,
    listRecent,
    close: () => pool.end(),
  };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function _normalise(hostname) {
  return hostname.replace(/^www\./, '');
}

// JSONB comes back parsed; booleans native. Emit BOTH key sets (legacy
// snake_case = published OJDS contract; camelCase = additive DTO) — must match
// the former SQLite backend's _parseRow exactly.
function _parseRow(row) {
  return {
    ...row,
    cloudflare_blocked: row.cloudflare_blocked === true,
    flags:  row.flags_json       || [],
    result: row.full_result_json || null,
    runId:                row.run_id,
    analysedAt:           row.analysed_at,
    cloudflareBlocked:    row.cloudflare_blocked === true,
    scoreOverall:         row.score_overall,
    scoreSurveillance:    row.score_surveillance,
    scoreAdtech:          row.score_adtech,
    scoreBloat:           row.score_bloat,
    scoreConsentPaywall:  row.score_consent_paywall,
    scoreOpenness:        row.score_openness,
    scorePerformance:     row.score_performance,
  };
}

// Lazily-created default store (built from DATABASE_URL). Importing the module
// touches no network until a method is first called.
let _defaultStore = null;
function _store() { return (_defaultStore ??= createStore()); }

module.exports = {
  init:                    (...a) => _store().init(...a),
  saveAnalysis:            (...a) => _store().saveAnalysis(...a),
  getAnalysis:             (...a) => _store().getAnalysis(...a),
  getPublicationHistory:   (...a) => _store().getPublicationHistory(...a),
  getLatestForPublication: (...a) => _store().getLatestForPublication(...a),
  listPublications:        (...a) => _store().listPublications(...a),
  listRecent:              (...a) => _store().listRecent(...a),
  createStore,
};
```

- [ ] **Step 2: load check** `node -e "require('./server/db-postgres.js'); console.log('loads ok')"` → `loads ok`
- [ ] **Step 3: commit** `feat(db): Neon Postgres backend — async createStore, additive DTO`

---

## Task 3: Port `db.test.js` to pg-mem (async, same assertions)

**Files:** Rewrite `server/db.test.js`

The 9 existing assertions stay; only the store construction + `await` change. pg-mem gives a `pg`-compatible Pool per test; `store.init()` runs the real DDL against it.

- [ ] **Step 1: write the file**

```javascript
'use strict';

// Analysis store — real schema + queries against in-memory Postgres via
// pg-mem, injected into createStore({ pool }). No network, no filesystem.

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const { newDb } = require('pg-mem');
const { createStore } = require('./db-postgres');

function fixtureResult(overrides = {}) {
  return {
    scores: {
      overall: 65,
      overallGrade: { grade: 'B', label: 'Moderate', colorClass: 'lime' },
      dimensions: {
        surveillance: 62, adTechDepth: 64, consentPaywallIntegrity: 62,
        pageBloat: 73, openness: 55, performance: 80,
      },
      openness: 55,
      flags: [{ id: 'no_rss', severity: 'low', label: 'No RSS Feed', note: 'drop me on save' }],
    },
    recommendations: [],
    ...overrides,
  };
}

// Fresh in-memory Postgres + initialised store per test.
async function freshStore() {
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  const store = createStore({ pool: new Pool() });
  await store.init();
  return store;
}

describe('Analysis store (pg-mem in-memory Postgres)', () => {
  let store;
  beforeEach(async () => { store = await freshStore(); });

  test('saveAnalysis → getAnalysis round-trip', async () => {
    await store.saveAnalysis('run-1', 'https://www.example.com/story', 'headless', fixtureResult(), true);
    const row = await store.getAnalysis('run-1');
    assert.equal(row.hostname, 'example.com');
    assert.equal(row.mode, 'headless');
    assert.equal(row.score_overall, 65);
    assert.equal(row.score_consent_paywall, 62);
    assert.equal(row.score_openness, 55);
    assert.equal(row.grade, 'B');
    assert.equal(row.cloudflare_blocked, true);
    assert.deepEqual(row.flags, [{ id: 'no_rss', severity: 'low', label: 'No RSS Feed' }]);
    assert.equal(row.result.scores.overall, 65);
    assert.equal(await store.getAnalysis('missing'), null);
  });

  test('same run_id replaces, not duplicates', async () => {
    await store.saveAnalysis('run-1', 'https://example.com/', 'headless', fixtureResult());
    await store.saveAnalysis('run-1', 'https://example.com/', 'headless',
      fixtureResult({ scores: { ...fixtureResult().scores, overall: 30 } }));
    const history = await store.getPublicationHistory('example.com');
    assert.equal(history.length, 1);
    assert.equal(history[0].score_overall, 30);
  });

  test('getPublicationHistory / getLatestForPublication normalise www.', async () => {
    await store.saveAnalysis('run-1', 'https://example.com/a', 'headless', fixtureResult());
    await store.saveAnalysis('run-2', 'https://www.example.com/b', 'live-browser', fixtureResult());
    assert.equal((await store.getPublicationHistory('www.example.com')).length, 2);
    const latest = await store.getLatestForPublication('example.com');
    assert.ok(['run-1', 'run-2'].includes(latest.run_id));
  });

  test('listPublications: one row per Publication, worst score first', async () => {
    await store.saveAnalysis('a1', 'https://bad.example/', 'headless',
      fixtureResult({ scores: { ...fixtureResult().scores, overall: 20 } }));
    await store.saveAnalysis('b1', 'https://good.example/', 'headless',
      fixtureResult({ scores: { ...fixtureResult().scores, overall: 90 } }));
    const pubs = await store.listPublications();
    assert.equal(pubs.length, 2);
    assert.equal(pubs[0].hostname, 'bad.example');
    assert.equal(pubs[0].score_overall, 20);
    assert.equal(pubs[0].run_count, 1);
  });

  test('listRecent caps at n', async () => {
    for (let i = 0; i < 5; i++) {
      await store.saveAnalysis(`r${i}`, `https://p${i}.example/`, 'headless', fixtureResult());
    }
    assert.equal((await store.listRecent(3)).length, 3);
  });

  test('unparseable URL falls back to raw string as hostname', async () => {
    await store.saveAnalysis('run-x', 'not a url', 'live-browser', fixtureResult());
    assert.equal((await store.getAnalysis('run-x')).hostname, 'not a url');
  });
});

describe('additive DTO (camelCase alongside legacy snake_case)', () => {
  test('parsed rows carry both key sets with equal values', async () => {
    const store = await freshStore();
    await store.saveAnalysis('run-dto', 'https://www.example.com/story', 'headless', fixtureResult(), true);
    const row = await store.getAnalysis('run-dto');
    assert.equal(row.runId, row.run_id);
    assert.equal(row.analysedAt, row.analysed_at);
    assert.equal(row.scoreOverall, row.score_overall);
    assert.equal(row.scoreConsentPaywall, row.score_consent_paywall);
    assert.equal(row.scoreOpenness, row.score_openness);
    assert.equal(row.cloudflareBlocked, true);
    assert.equal(row.cloudflare_blocked, true);
  });

  test('listPublications rows carry runCount/lastAnalysed/scoreOverall', async () => {
    const store = await freshStore();
    await store.saveAnalysis('r1', 'https://example.com/', 'headless', fixtureResult());
    const [pub] = await store.listPublications();
    assert.equal(pub.runCount, pub.run_count);
    assert.equal(pub.lastAnalysed, pub.last_analysed);
    assert.equal(pub.scoreOverall, pub.score_overall);
  });
});
```

- [ ] **Step 2: run ONLY this test file** `node --test server/db.test.js 2>&1 | tail -8`
Expected: all 9 tests pass. **If pg-mem rejects any DDL/SQL** (e.g. `ON CONFLICT`, `NULLS LAST`, `BIGSERIAL`, correlated subquery): note the exact error and see "pg-mem compatibility" appendix below before adapting — do NOT change prod SQL semantics just to appease pg-mem without checking it still works on real Neon.
- [ ] **Step 3: commit** `test(db): port store tests to pg-mem (async)`

---

## Task 4: Rewrite `db.js` wrapper

**Files:** Rewrite `server/db.js`; `git rm server/db-sqlite.js`

- [ ] **Step 1: write `server/db.js`**

```javascript
'use strict';

// Neon Postgres persistence. The no-op stub is ONLY used when
// TARE_ALLOW_NO_DB=1; otherwise a missing DATABASE_URL is fatal so
// persistence can never silently die. Re-exports createStore for tests/tooling.
if (process.env.TARE_ALLOW_NO_DB === '1') {
  console.warn('[tare] WARNING: TARE_ALLOW_NO_DB=1 — persistence disabled, analyses will NOT be saved.');
  module.exports = {
    init:                    async () => {},
    saveAnalysis:            async () => {},
    getAnalysis:             async () => null,
    getPublicationHistory:   async () => [],
    getLatestForPublication: async () => null,
    listPublications:        async () => [],
    listRecent:              async () => [],
    createStore:             require('./db-postgres').createStore,
  };
} else if (!process.env.DATABASE_URL) {
  console.error('[tare] FATAL: DATABASE_URL is not set — analyses would be silently discarded.');
  console.error('[tare] Set DATABASE_URL to your Neon connection string,');
  console.error('[tare] or set TARE_ALLOW_NO_DB=1 to knowingly run without persistence.');
  throw new Error('DATABASE_URL is required for persistence');
} else {
  module.exports = require('./db-postgres');
}
```

- [ ] **Step 2** `git rm server/db-sqlite.js`
- [ ] **Step 3: verify loud-fail**
```bash
node -e "require('./server/db.js')" ; echo "exit=$?"
TARE_ALLOW_NO_DB=1 node -e "const d=require('./server/db.js'); d.saveAnalysis().then(()=>console.log('stub ok'))"
```
Expected: first → `[tare] FATAL: DATABASE_URL is not set` + throw (exit≠0); second → warning then `stub ok`.
- [ ] **Step 4: commit** `refactor(db): Postgres-only loud-fail wrapper, drop SQLite backend`

---

## Task 5: Async propagation in `index.js`

**Files:** `server/index.js` (line refs are main @ 31f38ed; re-confirm before editing)

- [ ] **Step 1: import `init` alongside `saveAnalysis` (line 12)**
Change `const { saveAnalysis } = require('./db');` →
```javascript
const { saveAnalysis, init: initDb } = require('./db');
```
- [ ] **Step 2: await headless persist (line ~89, inside the async IIFE)**
`saveAnalysis(jobId, url, 'headless', result, cfBlocked);` → `await saveAnalysis(jobId, url, 'headless', result, cfBlocked);`
- [ ] **Step 3: await /score persist (line ~290, handler already async)**
`saveAnalysis(runId, payload.url, 'live-browser', result);` → `await saveAnalysis(runId, payload.url, 'live-browser', result);`
- [ ] **Step 4: publications routes async (lines ~201 and ~212)**
`app.get('/api/publications', (req, res) => {` → `app.get('/api/publications', async (req, res) => {` and `res.json({ publications: listPublications() });` → `res.json({ publications: await listPublications() });`
`app.get('/api/publications/:hostname', (req, res) => {` → `... async (req, res) => {` and `const history = getPublicationHistory(...)` → `const history = await getPublicationHistory(...)`.
- [ ] **Step 5: init schema before listen (line ~303)**
```javascript
app.listen(PORT, () => {
  console.log(`Web Bloat Checker running at http://localhost:${PORT}`);
});
```
→
```javascript
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Web Bloat Checker running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[tare] FATAL: database init failed:', err.message);
    process.exit(1);
  });
```
- [ ] **Step 6** `node --check server/index.js && echo "syntax ok"`
- [ ] **Step 7: commit** `refactor(api): await async persistence, init schema at boot`

---

## Task 6: Async `export.js`

**Files:** `server/export.js`

- [ ] **Step 1** `function exportAll() {` → `async function exportAll() {`; `const publications = listPublications();` → `const publications = await listPublications();`; `const history = getPublicationHistory(row.hostname);` → `const history = await getPublicationHistory(row.hostname);`
- [ ] **Step 2** CLI entry (line ~98): `exportAll();` → `exportAll().catch((err) => { console.error('[export] failed:', err.message); process.exit(1); });`
- [ ] **Step 3** `node --check server/export.js && echo "syntax ok"`
- [ ] **Step 4: commit** `refactor(export): await async persistence reads`

---

## Task 7: Dockerfile + env docs

**Files:** `Dockerfile`, `.env.example`, `README.md`

- [ ] **Step 1** Delete Dockerfile line 5 `    python3 make g++ \`. Verify: `grep -c "python3 make g++" Dockerfile` → `0`.
- [ ] **Step 2** Append to `.env.example` (keep existing `PORT`):
```bash
# Neon Postgres POOLED connection string (host contains "-pooler").
DATABASE_URL=postgres://USER:PASSWORD@ep-xxxx-pooler.REGION.aws.neon.tech/DBNAME?sslmode=require
# Set to 1 ONLY to run without persistence (analyses discarded).
# TARE_ALLOW_NO_DB=1
```
- [ ] **Step 3** README persistence note: "Analyses are stored in Neon Postgres (`DATABASE_URL`, pooled). Schema auto-creates at boot. `npm test` needs no DB (uses pg-mem)."
- [ ] **Step 4: commit** `chore: drop native build-tools; document Neon DATABASE_URL`

---

## Task 8: Full-suite + local Neon verify (VERIFY GATE)

- [ ] **Step 1: full suite offline** `npm test 2>&1 | tail -6` → all pass (was 180 on main + these 9 ported; expect prior count, 0 fail). Confirm no regression from other suites.
- [ ] **Step 2: real-Neon round-trip** (uses the loader for the `&` in DATABASE_URL; secret stays in `.env`):
```bash
LOADER=/private/tmp/claude-501/-Users-subhashrai-projects/b6be7733-2788-45b2-9289-1237b71c423a/scratchpad/loadenv.js
node -r "$LOADER" -e "
const db=require('./server/db');(async()=>{
 await db.init();
 await db.saveAnalysis('verify-v2-1','https://example.com/x','headless',{scores:{overall:42,overallGrade:{grade:'C'},dimensions:{surveillance:50},flags:[{id:'f1',severity:'high',label:'t'}]}},true);
 const b=await db.getAnalysis('verify-v2-1');
 console.log('read',b.run_id,b.grade,b.cloudflareBlocked,b.scoreOverall,'flags',b.flags.length);
 console.log('pubs',JSON.stringify(await db.listPublications()));
 process.exit(0);})().catch(e=>{console.error('ERR',e.message);process.exit(1);});"
```
Expected: `read verify-v2-1 C true 42 flags 1` and a publications row with both `run_count` and `runCount`.
- [ ] **Step 3: durability** — rerun `getAnalysis('verify-v2-1')` in a fresh process → still present.
- [ ] **Step 4: clean** — `DELETE FROM analyses WHERE run_id='verify-v2-1'`, confirm count 0.
- [ ] **Step 5: STOP — report to operator.** Task 9 (prod) is a gated, outward-facing step.

---

## Task 9: Production deploy (GATED — get explicit go)

- [ ] **Step 1** `flyctl secrets set DATABASE_URL='<pooled prod string>' --app tare` (triggers restart)
- [ ] **Step 2** `flyctl deploy --app tare` (build has no python/gyp step now)
- [ ] **Step 3** `curl -sS -o /dev/null -w "HTTP %{http_code}\n" https://tare.fly.dev/` → 200; `flyctl logs --app tare --no-tail | grep -iE "FATAL|database init|listening"` → clean
- [ ] **Step 4** Cross-machine: trigger an analysis, hit `/api/publications` repeatedly → row consistent across both machines
- [ ] **Step 5** Push branch, open PR to main, merge after checks green.

---

## pg-mem compatibility appendix (read if Task 3 Step 2 fails)

pg-mem emulates a subset of Postgres. Known-risky constructs used here and the verdict:
- `BIGSERIAL` — supported. (Chose over `GENERATED ... IDENTITY`, which pg-mem historically rejects.)
- `JSONB` + `JSON.stringify` param — supported; reads back parsed.
- `ON CONFLICT (run_id) DO UPDATE` — supported (requires the `UNIQUE` on `run_id`, which we declare).
- Correlated subquery in `listPublications` — supported.
- `ORDER BY ... ASC NULLS LAST` — supported.
- `COUNT(*)` returns string → coerced with `Number()` (both pg and pg-mem).

If a construct genuinely isn't emulated, prefer `mem.public.registerFunction`/pg-mem shims in the TEST harness over weakening the prod query. The prod target is real Neon Postgres — never trade real-PG correctness for pg-mem convenience. If unfixable, fall back to the alternative test strategy (Neon test branch in CI) rather than SQLite.

---

## Self-Review

**Spec coverage vs main's contract:**
- `createStore` factory preserved (now with injectable `pool` for pg-mem). ✓
- Additive DTO preserved — `_parseRow` emits both key sets; `listPublications` adds runCount/lastAnalysed/scoreOverall. ✓ (Task 3 asserts it.)
- 9 `db.test.js` assertions preserved (async). ✓
- All persist/read call sites reconciled onto main's line numbers (89/201/212/290/303 index.js; 32/56/99 export.js). ✓
- Loud-fail wrapper + `TARE_ALLOW_NO_DB` opt-out. ✓
- No native build (pg + pg-mem pure JS) → Dockerfile trimmed. ✓
- Durability + cross-machine proven in Tasks 8–9. ✓

**Type consistency:** method names identical across db-postgres.js ↔ db.js ↔ index.js/export.js call sites. `run_count` (snake) AND `runCount` (camel) both Number. `cloudflare_blocked`/`cloudflareBlocked` both boolean.

**Deltas from v1 plan:** async `createStore` (was module-level pool); pg-mem tests (v1 had none — main added db.test.js); `BIGSERIAL` (was `GENERATED IDENTITY`) for pg-mem; DTO camelCase now required (main added it). The verified-working Neon SQL from the old branch is reused unchanged in substance.
