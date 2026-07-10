'use strict';

/**
 * SQLite persistence for analysis runs.
 *
 * Stores every completed analysis (both Headless and Live Browser modes).
 * Source of truth for the local index and the export pipeline.
 *
 * Schema decisions:
 * - One row per analysis run. Publications have many runs over time.
 * - hostname is the canonical Publication identifier (extracted from URL).
 * - scores stored as flat numeric columns for fast sorting/filtering.
 * - full_result stored as JSON blob for report card rendering and export.
 * - No foreign keys — single-table design keeps the schema simple.
 *
 * The module exports a default store on data/analyses.db (path overridable
 * via TARE_DB_PATH) plus createStore(dbPath) for tests and tooling — pass
 * ':memory:' to run the real schema and statements against an in-memory
 * database with no filesystem side effects.
 */

const path  = require('path');
const fs    = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR        = path.join(__dirname, '..', 'data');
const DEFAULT_DB_PATH = process.env.TARE_DB_PATH || path.join(DATA_DIR, 'analyses.db');

function createStore(dbPath = DEFAULT_DB_PATH) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);

  // WAL mode: faster writes, safe concurrent reads from the export script
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // ── Schema ─────────────────────────────────────────────────────────────────

  db.exec(`
    CREATE TABLE IF NOT EXISTS analyses (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id                TEXT    NOT NULL UNIQUE,   -- UUID from jobId or generated for /score
      hostname              TEXT    NOT NULL,           -- canonical Publication identifier
      url                   TEXT    NOT NULL,           -- full URL analysed
      mode                  TEXT    NOT NULL DEFAULT 'headless', -- 'headless' | 'live-browser'
      analysed_at           TEXT    NOT NULL,           -- ISO-8601 UTC timestamp

      -- Dimension scores (0–100, higher = better)
      score_overall         INTEGER,
      score_surveillance    INTEGER,
      score_adtech          INTEGER,
      score_bloat           INTEGER,
      score_consent_paywall INTEGER,
      score_openness        INTEGER,
      score_performance     INTEGER,

      -- Grade letter for overall
      grade                 TEXT,

      -- Cloudflare / bot-protection warning (headless mode only)
      cloudflare_blocked    INTEGER NOT NULL DEFAULT 0, -- boolean

      -- Flags as JSON array of { id, severity, label }
      flags_json            TEXT,

      -- Full result blob for report card rendering and export
      full_result_json      TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_analyses_hostname    ON analyses(hostname);
    CREATE INDEX IF NOT EXISTS idx_analyses_analysed_at ON analyses(analysed_at);
    CREATE INDEX IF NOT EXISTS idx_analyses_overall     ON analyses(score_overall);
  `);

  // ── Prepared statements ────────────────────────────────────────────────────

  const INSERT = db.prepare(`
    INSERT OR REPLACE INTO analyses (
      run_id, hostname, url, mode, analysed_at,
      score_overall, score_surveillance, score_adtech, score_bloat,
      score_consent_paywall, score_openness, score_performance,
      grade, cloudflare_blocked, flags_json, full_result_json
    ) VALUES (
      @run_id, @hostname, @url, @mode, @analysed_at,
      @score_overall, @score_surveillance, @score_adtech, @score_bloat,
      @score_consent_paywall, @score_openness, @score_performance,
      @grade, @cloudflare_blocked, @flags_json, @full_result_json
    )
  `);

  const GET_BY_RUN_ID = db.prepare(
    'SELECT * FROM analyses WHERE run_id = ?'
  );

  const LIST_BY_HOSTNAME = db.prepare(
    'SELECT * FROM analyses WHERE hostname = ? ORDER BY analysed_at DESC'
  );

  const LATEST_BY_HOSTNAME = db.prepare(
    'SELECT * FROM analyses WHERE hostname = ? ORDER BY analysed_at DESC LIMIT 1'
  );

  const LIST_PUBLICATIONS = db.prepare(`
    SELECT hostname,
           COUNT(*)             AS run_count,
           MAX(analysed_at)     AS last_analysed,
           score_overall, grade
    FROM   analyses
    WHERE  analysed_at = (
      SELECT MAX(a2.analysed_at) FROM analyses a2 WHERE a2.hostname = analyses.hostname
    )
    GROUP BY hostname
    ORDER BY score_overall ASC
  `);

  const LIST_RECENT = db.prepare(
    'SELECT * FROM analyses ORDER BY analysed_at DESC LIMIT ?'
  );

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Persist a completed analysis result.
   *
   * @param {string} runId      - UUID (jobId for headless, generated for /score)
   * @param {string} url        - Publication URL that was analysed
   * @param {string} mode       - 'headless' | 'live-browser'
   * @param {object} result     - Full result object (same shape as /api/analyze)
   * @param {boolean} [cloudflareBlocked=false]
   * @returns {object} - The row as inserted
   */
  function saveAnalysis(runId, url, mode, result, cloudflareBlocked = false) {
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
      run_id:               runId,
      hostname,
      url,
      mode,
      analysed_at:          new Date().toISOString(),
      score_overall:        scores.overall         ?? null,
      score_surveillance:   dims.surveillance       ?? null,
      score_adtech:         dims.adTechDepth        ?? null,
      score_bloat:          dims.pageBloat          ?? null,
      score_consent_paywall:dims.consentPaywallIntegrity ?? null,
      score_openness:       scores.openness         ?? null,
      score_performance:    dims.performance        ?? null,
      grade:                scores.overallGrade?.grade ?? null,
      cloudflare_blocked:   cloudflareBlocked ? 1 : 0,
      flags_json:           JSON.stringify(flags.map(f => ({ id: f.id, severity: f.severity, label: f.label }))),
      full_result_json:     JSON.stringify(result),
    };

    INSERT.run(row);
    return row;
  }

  /**
   * Retrieve a single analysis by run ID.
   * Returns null if not found.
   */
  function getAnalysis(runId) {
    const row = GET_BY_RUN_ID.get(runId);
    return row ? _parseRow(row) : null;
  }

  /**
   * All analyses for a Publication, newest first.
   */
  function getPublicationHistory(hostname) {
    return LIST_BY_HOSTNAME.all(_normalise(hostname)).map(_parseRow);
  }

  /**
   * Most recent analysis for a Publication.
   */
  function getLatestForPublication(hostname) {
    const row = LATEST_BY_HOSTNAME.get(_normalise(hostname));
    return row ? _parseRow(row) : null;
  }

  /**
   * Index view: one row per Publication (latest run), sorted by score ascending.
   * Does NOT parse full_result_json — fast for building the index.
   */
  function listPublications() {
    return LIST_PUBLICATIONS.all();
  }

  /**
   * N most recent analyses across all Publications.
   */
  function listRecent(n = 20) {
    return LIST_RECENT.all(n).map(_parseRow);
  }

  return {
    saveAnalysis,
    getAnalysis,
    getPublicationHistory,
    getLatestForPublication,
    listPublications,
    listRecent,
    close: () => db.close(),
  };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function _normalise(hostname) {
  return hostname.replace(/^www\./, '');
}

function _parseRow(row) {
  return {
    ...row,
    cloudflare_blocked: row.cloudflare_blocked === 1,
    flags:  row.flags_json        ? JSON.parse(row.flags_json)        : [],
    result: row.full_result_json  ? JSON.parse(row.full_result_json)  : null,
  };
}

// Default store is created lazily on first use — importing this module (e.g.
// in tests that only need createStore(':memory:')) touches no files.
let _defaultStore = null;
function _store() { return (_defaultStore ??= createStore()); }

module.exports = {
  saveAnalysis:            (...args) => _store().saveAnalysis(...args),
  getAnalysis:             (...args) => _store().getAnalysis(...args),
  getPublicationHistory:   (...args) => _store().getPublicationHistory(...args),
  getLatestForPublication: (...args) => _store().getLatestForPublication(...args),
  listPublications:        (...args) => _store().listPublications(...args),
  listRecent:              (...args) => _store().listRecent(...args),
  createStore,
};
