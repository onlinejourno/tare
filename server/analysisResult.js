'use strict';

/**
 * Analysis Result assembly — the single place a scored Analysis is built.
 *
 * Both Analysis modes converge here: Headless (analyzer.js raw result via
 * /api/analyze) and Live Browser (score.js signal mapping via /score) each
 * produce an analysis object, and this module turns it into the final result:
 * Democratic Infrastructure Score, per-dimension grades, the Openness and
 * Paywall drill-down panels, flags, and recommendations. Mode parity — "both
 * modes produce the same structured score output" (CONTEXT.md, ADR-0003) — is
 * enforced by this seam rather than by keeping two hand-written copies in sync.
 */

const { democraticInfrastructureScore, scoreGrade, computeFlags } = require('./scoring');
const { opennessGrade } = require('./openness');
const { paywallGrade } = require('./paywallAudit');
const { generateRecommendations } = require('./recommendations');

/**
 * Assemble the complete scored result for one Analysis.
 *
 * @param {object} analysis - full analysis object (trackers, rtbCascade,
 *   consentAudit, darkPatterns, coverage, assets, requests,
 *   performanceMetrics, openness, paywallAudit, ...). Passed through onto the
 *   result unchanged; scoring never mutates it.
 * @param {object} meta
 * @param {'headless'|'live-browser'} meta.mode - which Analysis mode produced it
 * @param {string[]} [meta.missingSignals=[]] - signals unavailable in this run
 *   (e.g. jsCoverage in Live Browser mode); surfaced on the report card
 * @returns {object} `{ ...analysis, scores, recommendations }`
 */
function assembleAnalysisResult(analysis, { mode, missingSignals = [] }) {
  const dis   = democraticInfrastructureScore(analysis);
  const flags = computeFlags(analysis);
  const open  = analysis.openness || { overall: 50, dimensions: {} };
  const pw    = analysis.paywallAudit;

  return {
    ...analysis,
    scores: {
      overall: dis.overall,
      overallGrade: scoreGrade(dis.overall),
      dimensions: dis.dimensions,
      dimensionGrades: Object.fromEntries(
        Object.entries(dis.dimensions).map(([k, v]) => [k, scoreGrade(v)])
      ),
      flags,
      // Openness Score — second panel
      openness: open.overall,
      opennessGrade: opennessGrade(open.overall),
      opennessDimensions: open.dimensions,
      opennessDimensionGrades: Object.fromEntries(
        Object.entries(open.dimensions || {}).map(([k, v]) => [k, opennessGrade(v)])
      ),
      // Paywall Quality Score (only present when a paywall platform is detected)
      ...(pw ? {
        paywallScore:      pw.score,
        paywallGrade:      paywallGrade(pw.score),
        paywallDimensions: pw.dimensions,
      } : {}),
      // Deprecated aliases — report generator still reads these; remove when
      // the report moves to the six-dimension keys.
      pageHealth: dis.dimensions.pageBloat,
      pageHealthGrade: scoreGrade(dis.dimensions.pageBloat),
      privacy: dis.dimensions.surveillance,
      privacyGrade: scoreGrade(dis.dimensions.surveillance),
      // Analysis mode metadata — uniform across modes
      mode,
      missingSignals,
    },
    recommendations: generateRecommendations(analysis),
  };
}

module.exports = { assembleAnalysisResult };
