'use strict';
try {
  module.exports = require('./db-sqlite');
} catch (e) {
  module.exports = {
    saveAnalysis: () => {},
    getAnalysis: () => null,
    getPublicationHistory: () => [],
    getLatestForPublication: () => null,
    listPublications: () => [],
    listRecent: () => [],
  };
}
