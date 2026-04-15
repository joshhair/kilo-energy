import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, _resetForTests } from '@/lib/rate-limit';

beforeEach(() => { _resetForTests(); });

describe('checkRateLimit', () => {
  it('allows requests up to the limit', () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit('key1', 5, 60_000).ok).toBe(true);
    }
  });

  it('blocks the first request over the limit', () => {
    for (let i = 0; i < 5; i++) checkRateLimit('key1', 5, 60_000);
    const r = checkRateLimit('key1', 5, 60_000);
    expect(r.ok).toBe(false);
    expect(r.remaining).toBe(0);
    expect(r.retryAfterMs).toBeGreaterThan(0);
  });

  it('resets after the window passes', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) checkRateLimit('key1', 5, 60_000, t0);
    // Still in window → blocked
    expect(checkRateLimit('key1', 5, 60_000, t0 + 30_000).ok).toBe(false);
    // Past the window → allowed (new bucket)
    expect(checkRateLimit('key1', 5, 60_000, t0 + 60_001).ok).toBe(true);
  });

  it('tracks keys independently', () => {
    for (let i = 0; i < 5; i++) checkRateLimit('keyA', 5, 60_000);
    expect(checkRateLimit('keyA', 5, 60_000).ok).toBe(false);
    expect(checkRateLimit('keyB', 5, 60_000).ok).toBe(true);
  });

  it('reports decreasing remaining until zero', () => {
    expect(checkRateLimit('k', 3, 60_000).remaining).toBe(2);
    expect(checkRateLimit('k', 3, 60_000).remaining).toBe(1);
    expect(checkRateLimit('k', 3, 60_000).remaining).toBe(0);
    expect(checkRateLimit('k', 3, 60_000).ok).toBe(false);
  });
});
