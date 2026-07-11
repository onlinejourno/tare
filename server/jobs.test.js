'use strict';

// Job registry — the deepened interface: accessors instead of raw Maps, and
// concurrency derived from job state so the two can never drift.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const jobs = require('./jobs');

describe('job registry', () => {
  test('lifecycle: create → progress → complete, visible via accessors', () => {
    jobs.createJob('j1');
    assert.equal(jobs.getJob('j1').status, 'pending');
    assert.ok(jobs.getEmitter('j1'));

    jobs.emitProgress('j1', 'navigating', 15);
    assert.equal(jobs.getJob('j1').status, 'running');
    assert.equal(jobs.getJob('j1').progress, 15);

    jobs.emitComplete('j1', { ok: true });
    assert.equal(jobs.getJob('j1').status, 'complete');
    assert.deepEqual(jobs.getJob('j1').result, { ok: true });
  });

  test('runningCount counts pending+running, frees on complete/error', () => {
    const base = jobs.runningCount();
    jobs.createJob('j2');                       // pending — slot taken
    jobs.createJob('j3');
    jobs.emitProgress('j3', 'x', 5);            // running — still taken
    assert.equal(jobs.runningCount(), base + 2);

    jobs.emitComplete('j2', {});
    jobs.emitError('j3', new Error('boom'));
    assert.equal(jobs.runningCount(), base);
    assert.equal(jobs.getJob('j3').status, 'error');
  });

  test('emits on missing job are no-ops', () => {
    jobs.emitProgress('nope', 'x', 1);
    jobs.emitComplete('nope', {});
    assert.equal(jobs.getJob('nope'), undefined);
  });
});
