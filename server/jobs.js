'use strict';

const { EventEmitter } = require('events');

// In-process job registry — sufficient for single-user / low-concurrency use.
const jobs = new Map();     // jobId -> { status, progress, result, error }
const emitters = new Map(); // jobId -> EventEmitter

const JOB_TTL_MS = 10 * 60 * 1000; // 10 minutes

function createJob(jobId) {
  jobs.set(jobId, { status: 'pending', progress: 0, result: null, error: null });
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50);
  // Default error listener prevents Node from throwing ERR_UNHANDLED_ERROR
  // when no SSE client is connected at the moment emitError fires.
  emitter.on('error', () => {});
  emitters.set(jobId, emitter);
}

function emitProgress(jobId, stage, percent) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.progress = percent;
  job.status = 'running';
  emitters.get(jobId)?.emit('progress', { stage, percent });
}

function emitComplete(jobId, result) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = 'complete';
  job.result = result;
  emitters.get(jobId)?.emit('complete', result);
  setTimeout(() => cleanup(jobId), JOB_TTL_MS);
}

function emitError(jobId, err) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = 'error';
  job.error = err.message;
  emitters.get(jobId)?.emit('error', { message: err.message });
  setTimeout(() => cleanup(jobId), JOB_TTL_MS);
}

function cleanup(jobId) {
  jobs.delete(jobId);
  emitters.delete(jobId);
}

module.exports = { createJob, emitProgress, emitComplete, emitError, jobs, emitters };
