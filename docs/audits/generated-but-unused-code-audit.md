# Generated-but-Unused Code Audit — Tare

> **Correction (2026-08-08, founder):** the repo model in the original version of
> this doc was backwards. **`onlinejourno/tare-dev` (private) is the active
> development line; `onlinejourno/tare` (public) is published from it** — the
> standard private-first pair. `tare-dev` is **not** deprecated or archived. The
> code/doc cleanup findings below still stand (dead code removed, docs brought
> current, `knip` in CI); only the "archive tare-dev / all future dev on public
> tare" framing is superseded.

**Date:** 2026-08-08  
**Scope:** Dead-code and stale-config cleanup of the public `onlinejourno/tare` repo, bringing its docs current with the private `onlinejourno/tare-dev` dev line.  
**Goal:** Remove dead code, unused files, duplicated documentation, and stale configuration; ensure the public repo ships only what is built, tested, and used.

## Background

Tare (formerly packaged as `web-bloat-checker`) is one of OnlineJourno’s two MIT-licensed open-source tools. Development happens on the private `onlinejourno/tare-dev` line; the public `onlinejourno/tare` repo is published from it and had accumulated some drift (stale name in deploy config, docs behind the dev line). This pass cleans that drift on the public repo and ports the current docs across.

This document records the generated-but-unused code audit performed during that consolidation.

## Audit method

1. **Static analysis** — ran `npx knip` to detect unused files, dependencies, and exports.
2. **Syntax check** — ran `node --check server/*.js`.
3. **Test suite** — ran `npm test`.
4. **Manual review** — compared `tare-dev` against canonical `tare` for duplicated or stale assets.

## Findings and fixes

### 1. Dead-code detection was not automated

**Finding:** The repo had no automated way to detect unused files, dependencies, or exports.  
**Fix:**
- Added `knip` to `devDependencies`.
- Added `knip.json`:
  - Entry point: `public/app.js`
  - Project files: `server/**/*.js`, `public/**/*.js`
  - Ignored `@flydotio/dockerfile` (generated scaffolding, not runtime code)
  - Enabled `ignoreExportsUsedInFile: true`
- Added `npx knip` to the CI quality gate in `.github/workflows/ci.yml`.

### 2. Stale Fly.io config

**Finding:** `fly.web-bloat-checker.toml` referenced the old product name and was no longer used by the canonical deployment (`fly.toml`).  
**Fix:** Deleted `fly.web-bloat-checker.toml`.

### 3. Missing `reports/` placeholder

**Finding:** The runtime writes reports to `reports/`, but the directory was gitignored and absent from a fresh clone, which can confuse first-run users and CI.  
**Fix:** Added `reports/.gitkeep` so the directory exists in the repo while generated files remain ignored.

### 4. Duplicated / divergent documentation

**Finding:** `tare-dev` contained several docs that were either missing from or more current than canonical `tare`:
- `CLAUDE.md`
- `docs/agents/domain.md`
- `docs/agents/issue-tracker.md`
- `docs/agents/triage-labels.md`
- `docs/adr/0001-unified-crawler-ua-for-signal-probes.md`
- `docs/adr/0002-mcp-analysis-is-separate-from-web-ui.md`
- `docs/live-browser-analysis.md`
- `docs/adr/0003-scoring-rubric-lives-in-node.md` (superset of detail in `tare`)

**Fix:** Ported all of the above into canonical `tare`, merging ADR 0003 carefully so no duplicate or conflicting content remained. Updated `docs/agents/issue-tracker.md` to point to `https://github.com/onlinejourno/tare`.

### 5. README still carried old branding and maturity notes

**Finding:** README heading still said “Web Bloat Checker” and the maturity line said “Tare rename pending.”  
**Fix:**
- Renamed heading to “Tare”.
- Updated maturity line to reflect 180 passing tests and removed the “Tare rename pending” note.

### 6. `tare-dev` itself

**Superseded (see the correction at the top).** The original version deprecated +
archived `tare-dev`. That is reversed: **`tare-dev` remains the active private dev
line**; the archive is being undone and no deprecation header should point away
from it. Drift between the two repos is managed the normal private-first way
(publish from `tare-dev` to `tare`), not by retiring `tare-dev`.

## Verification

All checks were run locally in `/Users/subhashrai/projects/tare` before pushing:

```text
npm test                # 180 passing, 0 failing
node --check server/*.js # syntax OK
npx knip                # no unused files / dependencies / exports
```

## Result

The public `onlinejourno/tare` repository now:
- Builds and passes its full test suite.
- Has an automated dead-code detector (`knip`) wired into CI.
- Contains an up-to-date set of documentation, current with the dev line.
- No longer references the old `web-bloat-checker` name in deploy config or README.

Development continues on the private `onlinejourno/tare-dev` line; `tare` is
published from it (private-first). `tare-dev` is **not** deprecated — the earlier
archival is being reversed (see the correction at the top).
