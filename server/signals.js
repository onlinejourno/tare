'use strict';

// Shared vocabulary for the analysis signal bag passed between modules.
//
// These ids/values are an implicit contract: the Openness scorer (openness.js)
// EMITS them and computeFlags (scoring.js) / the paywall audit MATCH on them.
// When each side spelled the literal independently, a rename on one side silently
// stopped a flag firing (the wallType/paywallType bug class). Referencing these
// constants makes a rename single-source and turns a typo into a ReferenceError
// instead of a silent miss.

// AI-editorial signal ids emitted by the Openness scorer.
const AI_SIGNAL = {
  ALGO_RECS:           'algo_recs',
  PERSONALISATION:     'personalisation',
  AI_PAYWALL:          'ai_paywall',
  HEADLINE_TESTING:    'headline_testing',
  ALGO_WIDGETS:        'algo_widgets',
  EDITORIAL_ANALYTICS: 'editorial_analytics',
  AI_DISCLOSURE:       'ai_disclosure',
  NONE:                'no_ai_detected',
};

// Openness paywall-gate classification (distinct from the ad-blocker wall type).
const WALL_TYPE = {
  NONE:         'none',
  HARD:         'hard',
  METERED:      'metered',
  REGISTRATION: 'registration',
};

module.exports = { AI_SIGNAL, WALL_TYPE };
