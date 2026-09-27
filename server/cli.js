#!/usr/bin/env node
'use strict';

/**
 * Tare on the command line: analyse one URL, print JSON, exit on a budget.
 *
 * The web UI answers "how bloated is this page?" for a person. This answers the same
 * question for a build: a page has a transfer budget, and a build that quietly exceeds it
 * is how a site gets heavy one commit at a time. Exit 1 means a budget was broken — a
 * finding, not a failure of the tool; exit 2 means the tool could not do its job. A CI job
 * must be able to tell those apart.
 *
 *   tare-cli https://example.com/ --max-transfer-bytes 250kb --max-trackers 0
 */

const EXIT = { ok: 0, budget: 1, error: 2 };

const FLAGS = {
  '--max-transfer-bytes':    'maxTransferBytes',
  '--max-trackers':          'maxTrackers',
  '--max-third-party':       'maxThirdParty',
  '--max-unused-js-percent': 'maxUnusedJsPercent',
};

const USAGE = `tare <url> [budgets] [--json] [--allow-private]

Budgets (each optional; exit 1 if exceeded):
  --max-transfer-bytes <n>      total transfer, e.g. 250kb, 1mb, 250000
  --max-trackers <n>            known third-party trackers
  --max-third-party <n>         third-party requests
  --max-unused-js-percent <n>   share of shipped JavaScript never executed

  --json            print only the JSON summary (default prints a human line too)
  --allow-private   permit a private or loopback host (local testing only)

Exit: 0 within budget · 1 a budget was exceeded · 2 the analysis could not run`;

/** "250kb" and "1mb" are how a budget is written down; bare digits still work. */
function parseBytes(raw, flag) {
  const m = String(raw).trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb)?$/);
  if (!m) throw new Error(`${flag} must be a number, optionally with kb or mb — got "${raw}"`);
  const mult = { b: 1, kb: 1024, mb: 1024 * 1024, undefined: 1 }[m[2]];
  return Math.round(parseFloat(m[1]) * mult);
}

function parseArgs(argv) {
  const args = { json: false, allowPrivate: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') { args.json = true; continue; }
    if (a === '--allow-private') { args.allowPrivate = true; continue; }
    if (a === '--help' || a === '-h') { args.help = true; continue; }
    if (FLAGS[a]) { args[FLAGS[a]] = parseBytes(argv[++i], a); continue; }
    if (a.startsWith('--')) throw new Error(`unknown option ${a}\n\n${USAGE}`);
    rest.push(a);
  }
  if (!args.help && rest.length !== 1) throw new Error(`one url is required\n\n${USAGE}`);
  args.url = rest[0];
  return args;
}

/** Every budget the caller set, checked against what was measured. */
function evaluateBudget(result, budgets) {
  const measured = {
    transfer_bytes:       { actual: result.assets?.totalTransferBytes ?? 0,
                            budget: budgets.maxTransferBytes },
    trackers:             { actual: (result.trackers || []).length,
                            budget: budgets.maxTrackers },
    third_party_requests: { actual: result.requests?.thirdPartyCount ?? 0,
                            budget: budgets.maxThirdParty },
    unused_js_percent:    { actual: result.coverage?.jsUnusedPercent ?? 0,
                            budget: budgets.maxUnusedJsPercent },
  };
  return Object.entries(measured)
    .filter(([, m]) => m.budget !== undefined && m.actual > m.budget)
    .map(([check, m]) => ({ check, actual: m.actual, budget: m.budget }));
}

/** The shape a CI job reads. Small on purpose: the full report is the web UI's job. */
function summarise(result, violations) {
  return {
    url:                result.meta?.url,
    analyzedAt:         result.meta?.analyzedAt,
    toolVersion:        result.meta?.toolVersion,
    accessBlocked:      result.meta?.accessBlocked || null,
    transferBytes:      result.assets?.totalTransferBytes ?? 0,
    transferFormatted:  result.assets?.totalTransferFormatted,
    requests:           result.requests?.total ?? 0,
    thirdPartyRequests: result.requests?.thirdPartyCount ?? 0,
    trackers:           (result.trackers || []).length,
    trackerNames:       (result.trackers || []).map(t => t.name),
    unusedJsPercent:    result.coverage?.jsUnusedPercent ?? 0,
    unusedCssPercent:   result.coverage?.cssUnusedPercent ?? 0,
    scores:             result.scores || {},
    passed:             violations.length === 0,
    violations,
  };
}

function humanLine(s) {
  const parts = [
    `${s.transferFormatted || s.transferBytes + ' B'} transferred`,
    `${s.requests} requests (${s.thirdPartyRequests} third-party)`,
    `${s.trackers} tracker${s.trackers === 1 ? '' : 's'}`,
    `${s.unusedJsPercent}% of JS unused`,
  ];
  return `${s.url}\n  ${parts.join(' · ')}`;
}

async function main(argv = process.argv.slice(2), out = console) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    out.error(err.message);
    return EXIT.error;
  }
  if (args.help) { out.log(USAGE); return EXIT.ok; }

  const { validateUrl } = require('./ssrfGuard');
  const { analyzeUrl }  = require('./analyzer');
  const { assembleAnalysisResult } = require('./analysisResult');

  let url;
  try {
    // The same guard the server uses. `--allow-private` is for testing against a page on
    // this machine and is never what a CI job wants.
    url = args.allowPrivate ? args.url : await validateUrl(args.url);
  } catch (err) {
    out.error(`refused: ${err.message}`);
    return EXIT.error;
  }

  let result;
  try {
    const raw = await analyzeUrl(url, () => {});
    result = assembleAnalysisResult(raw, { mode: 'headless' });
  } catch (err) {
    out.error(`analysis failed: ${err.message}`);
    return EXIT.error;
  }

  const violations = evaluateBudget(result, args);
  const summary    = summarise(result, violations);

  out.log(JSON.stringify(summary, null, args.json ? 0 : 2));
  if (!args.json) {
    out.error(humanLine(summary));
    for (const v of violations) {
      out.error(`  OVER BUDGET ${v.check}: ${v.actual} > ${v.budget}`);
    }
    if (summary.accessBlocked) {
      out.error(`  NOTE: the page was blocked by ${summary.accessBlocked.by} — ` +
                'these numbers describe the block page, not the site.');
    }
  }
  return violations.length ? EXIT.budget : EXIT.ok;
}

module.exports = { parseArgs, parseBytes, evaluateBudget, summarise, humanLine, main, EXIT,
                   USAGE };

if (require.main === module) {
  main().then(code => { process.exitCode = code; });
}
