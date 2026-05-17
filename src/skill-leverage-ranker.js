'use strict';

/**
 * skill-leverage-ranker.js — thin adapter for the sibling skill-audit-loop repo.
 *
 * build-skill-audit-worklist.js imports `./skill-leverage-ranker` to get
 * telemetry-weighted ranking data.  The canonical implementation lives in the
 * parent Development workspace at `scripts/skill/skill-leverage-ranker.js`.
 *
 * This file tries to load the parent-repo version at runtime.  If it is not
 * found (e.g. this repo is checked out standalone), it returns a graceful
 * no-op report so the worklist builder can still produce output without
 * leverage scores.
 */

const path = require('path');

/** Minimal no-op report shape matching the real buildRankedReport output. */
function buildEmptyReport(skills) {
  return {
    generatedAt: new Date().toISOString(),
    source: 'skill-audit-loop/src/skill-leverage-ranker.js (no-op fallback)',
    top_skills: (skills || []).map((skill) => ({
      skill: skill.name || skill,
      score: 0,
      reasons: ['leverage data unavailable'],
      signals: {},
    })),
  };
}

// Attempt to resolve the parent-repo implementation.
// Walk up from the skill-audit-loop root to find `scripts/skill/skill-leverage-ranker.js`.
function resolveParentRanker() {
  // skill-audit-loop lives at <parent>/skill-audit-loop, so the scripts dir is
  // one level up from the package root.
  const candidates = [
    path.resolve(__dirname, '..', '..', 'scripts', 'skill', 'skill-leverage-ranker.js'),
    path.resolve(__dirname, '..', '..', '..', 'scripts', 'skill', 'skill-leverage-ranker.js'),
  ];

  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line global-require
      return require(candidate);
    } catch {
      // not found at this path — try the next candidate
    }
  }

  return null;
}

const parentRanker = resolveParentRanker();

/**
 * Rank skills by telemetry leverage.
 *
 * @param {{ skills: object[], limit?: number }} options
 * @returns {{ generatedAt: string, top_skills: object[] }}
 */
function buildRankedReport(options = {}) {
  if (parentRanker && typeof parentRanker.buildRankedReport === 'function') {
    try {
      return parentRanker.buildRankedReport(options);
    } catch {
      // Parent ranker failed (e.g. missing log files) — fall through to no-op
    }
  }

  return buildEmptyReport(options.skills || []);
}

module.exports = { buildRankedReport };
