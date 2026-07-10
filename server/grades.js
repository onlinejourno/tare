'use strict';

// Single owner of the A–F band cutoffs used across every 0–100 grader in this
// tool (Surveillance/composite, Openness, Paywall). The tiers are shared; only
// each grader's labels differ, so graders map gradeTier(score) → their own
// label table rather than re-hardcoding these cutoffs.
//
// NOTE: these are DELIBERATELY distinct from the OnlineJourno suite's bands
// (80/65/50/35). This tool grades reader treatment, not editorial quality.
// Founder decision 2026-07-04 — do not "unify" with that suite.

// Tier index: 0=A, 1=B, 2=C, 3=D, 4=F.
function gradeTier(score) {
  if (score >= 80) return 0;
  if (score >= 65) return 1;
  if (score >= 45) return 2;
  if (score >= 25) return 3;
  return 4;
}

module.exports = { gradeTier };
