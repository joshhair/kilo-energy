import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, _resetForTests } from '@/lib/rate-limit';

// These tests exercise the in-memory fallback path (no UPSTASH_REDIS_REST_URL
// in the vitest env). The Upstash path is exercised by prod smoke + the
// staging preview — mocking @upstash/redis would test the mock, not the
// integration.

beforeEach(() => { _resetForTests(); });

describe('checkRateLimit (in-memory fallback)', () => {
  it('allows requests up to the limit', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await checkRateLimit('key1', 5, 60_000)).ok).toBe(true);
    }
  });

  it('blocks the first request over the limit', async () => {
    for (let i = 0; i < 5; i++) await checkRateLimit('key1', 5, 60_000);
    const r = await checkRateLimit('key1', 5, 60_000);
    expect(r.ok).toBe(false);
    expect(r.remaining).toBe(0);
    expect(r.retryAfterMs).toBeGreaterThan(0);
  });

  it('resets after the window passes', async () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) await checkRateLimit('key1', 5, 60_000, t0);
    // Still in window → blocked
    expect((await checkRateLimit('key1', 5, 60_000, t0 + 30_000)).ok).toBe(false);
    // Past the window → allowed (new bucket)
    expect((await checkRateLimit('key1', 5, 60_000, t0 + 60_001)).ok).toBe(true);
  });

  it('tracks keys independently', async () => {
    for (let i = 0; i < 5; i++) await checkRateLimit('keyA', 5, 60_000);
    expect((await checkRateLimit('keyA', 5, 60_000)).ok).toBe(false);
    expect((await checkRateLimit('keyB', 5, 60_000)).ok).toBe(true);
  });

  it('reports decreasing remaining until zero', async () => {
    expect((await checkRateLimit('k', 3, 60_000)).remaining).toBe(2);
    expect((await checkRateLimit('k', 3, 60_000)).remaining).toBe(1);
    expect((await checkRateLimit('k', 3, 60_000)).remaining).toBe(0);
    expect((await checkRateLimit('k', 3, 60_000)).ok).toBe(false);
  });
});
