import { describe, expect, it } from 'vitest';
import { TapsaAPIError } from '../src/errors.js';

describe('TapsaAPIError', () => {
  it('is an Error with structured API details', () => {
    const error = new TapsaAPIError('Unauthorized', { status: 401, code: 'AUTH_FAILED', data: { reason: 'invalid key' } });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('TapsaAPIError');
    expect(error.status).toBe(401);
    expect(error.code).toBe('AUTH_FAILED');
    expect(error.data).toEqual({ reason: 'invalid key' });
  });
});
