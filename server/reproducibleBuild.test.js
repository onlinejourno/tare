'use strict';

// The image must install exactly what the tests ran against.
//
// Playwright is not an ordinary dependency: `playwright install chromium`
// fetches the browser build that the installed Playwright version asks for. So
// a semver range on Playwright is a range on the browser too, and a Docker
// build that resolves ranges at build time can ship a browser no test here has
// ever exercised — with every file in the repo unchanged, and nothing in the
// build output to show it happened.
//
// These assertions read the Dockerfile and the two manifests and never start a
// browser, which is what makes them cheap enough to keep in the unit suite.
// Their job is to make that drift impossible to reintroduce silently.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));

describe('the image is built from the lockfile', () => {
  test('the lockfile is copied into the image', () => {
    assert.match(
      dockerfile,
      /^COPY .*package-lock\.json.*$/m,
      'Dockerfile must COPY package-lock.json, or npm cannot install from it.'
    );
  });

  test('dependencies are installed with npm ci, never npm install', () => {
    assert.match(dockerfile, /^RUN npm ci\b/m, 'Dockerfile must RUN npm ci.');
    assert.doesNotMatch(
      dockerfile,
      /^RUN npm install\b/m,
      '`npm install` re-resolves ranges at build time; that is the drift this guards.'
    );
  });
});

describe('the browser version cannot drift', () => {
  test('playwright is pinned exactly, not to a range', () => {
    const declared = pkg.dependencies.playwright;

    // A range is the whole defect: it lets a rebuild change the browser with
    // no file in this repo changing, so no review ever sees it.
    assert.doesNotMatch(
      declared,
      /[\^~*x]|\s-\s|>|</,
      `playwright must be an exact version, got "${declared}".`
    );
  });

  test('the pinned version is the one the lockfile resolves', () => {
    assert.equal(
      lock.packages['node_modules/playwright'].version,
      pkg.dependencies.playwright,
      'package.json and package-lock.json name different Playwright versions; npm ci would refuse the build.'
    );
  });
});
