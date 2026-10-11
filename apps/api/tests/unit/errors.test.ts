import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  NotFoundError,
  ConflictError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  ServiceUnavailableError,
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

  test('ValidationError includes nested validation errors when provided and omits when undefined', () => {
    const details = { model_id: ['Required'] };
    const err = new ValidationError('Invalid request body', details);
    assert.equal(err.status, 400);

    const problem = err.toProblemDetails('/v1/jobs');
    assert.equal(problem.status, 400);
    assert.deepEqual(problem.errors, details);

    const errWithoutDetails = new ValidationError('Invalid request body');
    const problem2 = errWithoutDetails.toProblemDetails('/v1/jobs');
    assert.equal(problem2.errors, undefined);
  });

  test('UnauthorizedError, ForbiddenError, and ServiceUnavailableError format status codes', () => {
    const unauth = new UnauthorizedError();
    assert.equal(unauth.status, 401);
    assert.equal(unauth.code, 'UNAUTHORIZED');

    const forbidden = new ForbiddenError();
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.code, 'FORBIDDEN');

    const unavailable = new ServiceUnavailableError();
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.code, 'SERVICE_UNAVAILABLE');
  });
});


