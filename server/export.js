'use strict';

/**
 * Export pipeline — generates static JSON for the Analyst's website.
 *
 * Reads from local SQLite (source of truth), writes to /exports/:
 *   index.json                   — all Publications, latest score each, sorted by score asc
 *   publications/<hostname>.json — full history for one Publication
 *
 * Run via:  node server/export.js
 *       or: npm run export-index
 *
 * The exports directory is the deploy artefact — Analyst uploads its contents
 * to their website's static file host or CMS. (C1 architecture, live-browser-analysis.md)
 */

const fs   = require('fs');
const path = require('path');
const {
  listPublications,
  getPublicationHistory,
} = require('./db');

const EXPORTS_DIR = path.join(__dirname, '..', 'exports');
const PUBS_DIR    = path.join(EXPORTS_DIR, 'publications');

// ── Main ─────────────────────────────────────────────────────────────────────

function exportAll() {
  fs.mkdirSync(PUBS_DIR, { recursive: true });

  const publications = listPublications();
  const generatedAt  = new Date().toISOString();

  // ── index.json ──────────────────────────────────────────────────────────
  const indexEntries = publications.map(row => ({
    hostname:      row.hostname,
    score:         row.score_overall,
    grade:         row.grade,
    runCount:      row.run_count,
    lastAnalysed:  row.last_analysed,
  }));

  const indexPayload = {
    generatedAt,
    count:        indexEntries.length,
    publications: indexEntries,
  };

  _write(path.join(EXPORTS_DIR, 'index.json'), indexPayload);
  console.log(`[export] index.json — ${indexEntries.length} publication(s)`);

  // ── publications/<hostname>.json ─────────────────────────────────────────
  let pubCount = 0;
  for (const row of publications) {
    const history = getPublicationHistory(row.hostname);

    const pubPayload = {
      generatedAt,
      hostname:  row.hostname,
      runCount:  history.length,
      runs: history.map(r => ({
        runId:          r.run_id,
        url:            r.url,
        mode:           r.mode,
        analysedAt:     r.analysed_at,
        score:          r.score_overall,
        grade:          r.grade,
        cloudflareBlocked: r.cloudflare_blocked,
        dimensions: {
          surveillance:       r.score_surveillance,
          adTechDepth:        r.score_adtech,
          pageBloat:          r.score_bloat,
          consentPaywall:     r.score_consent_paywall,
          openness:           r.score_openness,
          performance:        r.score_performance,
        },
        flags: r.flags,
        // Full result available for report card rendering
        result: r.result,
      })),
    };

    _write(path.join(PUBS_DIR, `${row.hostname}.json`), pubPayload);
    pubCount++;
  }

  console.log(`[export] publications/ — ${pubCount} file(s)`);
  console.log(`[export] done → ${EXPORTS_DIR}`);
}

function _write(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// ── CLI entry point ──────────────────────────────────────────────────────────

if (require.main === module) {
  exportAll();
}

module.exports = { exportAll };
