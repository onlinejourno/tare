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
