import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  NotFoundError,
  ConflictError,
  ValidationError,
  UnauthorizedError,
  AppError,
} from '../../src/domain/errors.js';

describe('RFC 7807 Domain Errors', () => {
  test('NotFoundError formats problem details correctly', () => {
    const err = new NotFoundError('Job 123 not found');
    assert.equal(err.status, 404);
    assert.equal(err.code, 'NOT_FOUND');

    const problem = err.toProblemDetails('/v1/jobs/123');
    assert.equal(problem.status, 404);
    assert.equal(problem.title, 'Resource Not Found');
    assert.equal(problem.detail, 'Job 123 not found');
    assert.equal(problem.instance, '/v1/jobs/123');
    assert.equal(problem.code, 'NOT_FOUND');
    assert.ok(problem.timestamp);
  });

  test('ConflictError formats problem details correctly', () => {
    const err = new ConflictError('Cannot cancel completed job');
    assert.equal(err.status, 409);
    assert.equal(err.code, 'CONFLICT');

    const problem = err.toProblemDetails();
    assert.equal(problem.status, 409);
    assert.equal(problem.title, 'Conflict');
  });

  test('ValidationError includes nested validation errors', () => {
    const details = { model_id: ['Required'] };
    const err = new ValidationError('Invalid request body', details);
    assert.equal(err.status, 400);

    const problem = err.toProblemDetails('/v1/jobs');
    assert.equal(problem.status, 400);
    assert.deepEqual(problem.errors, details);
  });

  test('UnauthorizedError formats 401 status', () => {
    const err = new UnauthorizedError();
    assert.equal(err.status, 401);
    assert.equal(err.code, 'UNAUTHORIZED');
  });
});

