'use strict';

// SQLite persistence, with an explicit opt-out for environments that cannot
// build/load better-sqlite3. The stub is ONLY used when TARE_ALLOW_NO_DB=1;
// otherwise a require failure is fatal so persistence can never silently die.
try {
  module.exports = require('./db-sqlite');
} catch (e) {
  if (process.env.TARE_ALLOW_NO_DB !== '1') {
    console.error('[tare] FATAL: failed to load SQLite persistence (better-sqlite3).');
    console.error('[tare] Analyses would be silently discarded. Run `npm install`,');
    console.error('[tare] or set TARE_ALLOW_NO_DB=1 to knowingly run without persistence.');
    throw e;
  }
  console.warn('[tare] WARNING: TARE_ALLOW_NO_DB=1 — persistence disabled, analyses will NOT be saved.');
  console.warn(`[tare] Underlying load error: ${e.message}`);
  module.exports = {
    saveAnalysis: () => {},
    getAnalysis: () => null,
    getPublicationHistory: () => [],
    getLatestForPublication: () => null,
    listPublications: () => [],
    listRecent: () => [],
  };
}
