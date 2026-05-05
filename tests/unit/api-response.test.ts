/**
 * Smoke tests for lib/api-response.ts. The helpers are thin — these
 * tests exist to guarantee the wire shape stays stable. If any caller
 * starts depending on { ok: true, data: T }, that contract is what
 * these tests pin.
 */
import { describe, it, expect } from 'vitest';
import { apiOk, apiError, apiErrorFromValidation } from '@/lib/api-response';

describe('apiOk', () => {
  it('wraps the payload with { ok: true, data }', async () => {
    const res = apiOk({ id: 'p1', name: 'Hello' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, data: { id: 'p1', name: 'Hello' } });
  });
  it('honors a custom status code', async () => {
    const res = apiOk({ id: 'p1' }, 201);
    expect(res.status).toBe(201);
  });
  it('serializes nested objects unchanged', async () => {
    const res = apiOk({ tiers: [{ closer: 1 }, { closer: 2 }] });
    const body = await res.json() as { ok: true; data: { tiers: Array<{ closer: number }> } };
    expect(body.data.tiers).toHaveLength(2);
  });
});

describe('apiError', () => {
  it('wraps with { ok: false, reason } and 400 by default', async () => {
    const res = apiError('Name cannot be empty');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ ok: false, reason: 'Name cannot be empty' });
  });
  it('honors custom status code', async () => {
    const res = apiError('Forbidden', 403);
    expect(res.status).toBe(403);
  });
  it('attaches optional machine-readable code', async () => {
    const res = apiError('No retroactive dates', 400, 'retroactive_effective_date');
    const body = await res.json();
    expect(body).toEqual({
      ok: false,
      reason: 'No retroactive dates',
      code: 'retroactive_effective_date',
    });
  });
});

describe('apiErrorFromValidation', () => {
  it('converts a ValidationResult failure into an HTTP response', async () => {
    const validation = { ok: false as const, reason: 'Email format is not valid' };
    const res = apiErrorFromValidation(validation);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ ok: false, reason: 'Email format is not valid' });
  });
});
