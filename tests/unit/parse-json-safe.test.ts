import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { parseJsonSafe } from '@/lib/api-validation';

describe('parseJsonSafe', () => {
  it('parses + validates a string array', () => {
    expect(parseJsonSafe('["a", "b"]', z.array(z.string()))).toEqual(['a', 'b']);
  });

  it('parses + validates a numeric record', () => {
    expect(
      parseJsonSafe('{"New":5,"Design":30}', z.record(z.string(), z.number())),
    ).toEqual({ New: 5, Design: 30 });
  });

  it('returns null on malformed JSON', () => {
    expect(parseJsonSafe('not-json', z.array(z.string()))).toBeNull();
    expect(parseJsonSafe('{', z.array(z.string()))).toBeNull();
  });

  it('returns null when the parsed shape fails schema validation', () => {
    // string array but contains a number
    expect(parseJsonSafe('["a", 2]', z.array(z.string()))).toBeNull();
    // object expected, array given
    expect(parseJsonSafe('[]', z.record(z.string(), z.number()))).toBeNull();
  });

  it('returns null for null/undefined/empty inputs', () => {
    expect(parseJsonSafe(null, z.string())).toBeNull();
    expect(parseJsonSafe(undefined, z.string())).toBeNull();
    expect(parseJsonSafe('', z.string())).toBeNull();
  });

  it('lets callers fall back via ?? (canonical usage)', () => {
    const recipients = parseJsonSafe('not-json', z.array(z.string())) ?? [];
    expect(recipients).toEqual([]);
    const thresholds = parseJsonSafe('null', z.record(z.string(), z.number())) ?? {};
    expect(thresholds).toEqual({});
  });

  it('respects refine() in the schema (filters via validation rule)', () => {
    const positiveOnly = z.record(
      z.string(),
      z.number().refine((v) => Number.isFinite(v) && v > 0),
    );
    // valid: every value > 0
    expect(parseJsonSafe('{"a":5,"b":10}', positiveOnly)).toEqual({ a: 5, b: 10 });
    // invalid: a value is 0 — refine rejects, whole parse fails
    expect(parseJsonSafe('{"a":5,"b":0}', positiveOnly)).toBeNull();
  });
});
