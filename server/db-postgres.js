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
