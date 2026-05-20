// Quiet hours window math.
//
// The dispatcher uses isInQuietHours() to decide whether to suppress
// sms + push for a non-mandatory event. The window is hour-precision
// UTC and supports midnight wraparound — these tests pin both the
// non-wrapping case (e.g. 09→17 daytime DND, weird but valid) and the
// far more common wrapping case (e.g. 22→07 nighttime DND).

import { describe, it, expect } from 'vitest';
import { isInQuietHours } from '@/lib/notifications/service';

describe('isInQuietHours', () => {
  it('returns false when either bound is null', () => {
    expect(isInQuietHours(null, 7, 23)).toBe(false);
    expect(isInQuietHours(22, null, 23)).toBe(false);
    expect(isInQuietHours(null, null, 0)).toBe(false);
  });

  it('returns false for empty window (start === end)', () => {
    expect(isInQuietHours(8, 8, 8)).toBe(false);
  });

  it('non-wrapping: hours inside [start, end) are quiet', () => {
    expect(isInQuietHours(9, 17, 9)).toBe(true); // start inclusive
    expect(isInQuietHours(9, 17, 12)).toBe(true);
    expect(isInQuietHours(9, 17, 16)).toBe(true);
    expect(isInQuietHours(9, 17, 17)).toBe(false); // end exclusive
    expect(isInQuietHours(9, 17, 8)).toBe(false);
    expect(isInQuietHours(9, 17, 18)).toBe(false);
  });

  it('wrapping window 22→07: late night + early morning are quiet', () => {
    expect(isInQuietHours(22, 7, 22)).toBe(true);
    expect(isInQuietHours(22, 7, 23)).toBe(true);
    expect(isInQuietHours(22, 7, 0)).toBe(true);
    expect(isInQuietHours(22, 7, 3)).toBe(true);
    expect(isInQuietHours(22, 7, 6)).toBe(true);
    expect(isInQuietHours(22, 7, 7)).toBe(false); // end exclusive
    expect(isInQuietHours(22, 7, 8)).toBe(false);
    expect(isInQuietHours(22, 7, 21)).toBe(false);
  });
});
