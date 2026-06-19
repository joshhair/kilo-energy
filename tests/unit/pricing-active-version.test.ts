import { describe, it, expect } from 'vitest';
import { pickEffectiveVersion, type EffectiveWindow } from '@/lib/pricing/active-version';

// Phase 3 A0 golden test: hydrating baseline tiers must NEVER select a future-
// dated version, even when it is the most recently created/open one. This is the
// regression guard for the /api/data leak (`?? pricingVersions[0]`).

const NOW = new Date('2026-06-16T12:00:00Z');

describe('pickEffectiveVersion', () => {
  it('selects the open version that is currently effective', () => {
    const versions: (EffectiveWindow & { id: string })[] = [
      { id: 'old', effectiveFrom: '2026-01-01', effectiveTo: '2026-04-28' },
      { id: 'current', effectiveFrom: '2026-04-29', effectiveTo: null },
    ];
    expect(pickEffectiveVersion(versions, NOW)?.id).toBe('current');
  });

  it('does NOT leak a future-dated version (the A0 bug)', () => {
    // A future publish exists and is the open one. Old fallback returned it.
    const versions: (EffectiveWindow & { id: string })[] = [
      { id: 'current', effectiveFrom: '2026-04-29', effectiveTo: '2026-06-30' },
      { id: 'future', effectiveFrom: '2026-07-01', effectiveTo: null },
    ];
    expect(pickEffectiveVersion(versions, NOW)?.id).toBe('current');
  });

  it('returns undefined when every version is future-dated (empty tiers, not future rates)', () => {
    const versions: (EffectiveWindow & { id: string })[] = [
      { id: 'future', effectiveFrom: '2026-07-01', effectiveTo: null },
    ];
    expect(pickEffectiveVersion(versions, NOW)).toBeUndefined();
  });

  it('picks the most-recent effective version regardless of array order', () => {
    const versions: (EffectiveWindow & { id: string })[] = [
      { id: 'b', effectiveFrom: '2026-04-29', effectiveTo: null },
      { id: 'a', effectiveFrom: '2026-01-01', effectiveTo: '2026-04-28' },
    ];
    expect(pickEffectiveVersion(versions, NOW)?.id).toBe('b');
  });

  it('treats a version effective exactly at now as effective (boundary)', () => {
    const versions: (EffectiveWindow & { id: string })[] = [
      { id: 'today', effectiveFrom: NOW, effectiveTo: null },
    ];
    expect(pickEffectiveVersion(versions, NOW)?.id).toBe('today');
  });

  it('returns undefined for no versions', () => {
    expect(pickEffectiveVersion([], NOW)).toBeUndefined();
  });
});
