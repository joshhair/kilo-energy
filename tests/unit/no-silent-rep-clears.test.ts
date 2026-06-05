/**
 * Regression tests for the setter/rep/blitz silent-drop guard.
 *
 * Locks in the protection behind FOUR real production incidents where a
 * reactive clear silently dropped a chosen value from a submitted deal:
 *   - 2026-04-22  Tyson dropped from Trevor Schauwecker's deal
 *   - 2026-04-26  setter dropped from Bryce Marsh's Melissa Lance deal
 *   - 2026-05-11  setter dropped from Hunter Helton's deal
 *   - 2026-05-23  Patrick dropped from Bryce Marsh's deal
 *
 * The four cases below are deliberately DIFFERENT code shapes (single-line,
 * multiline, template-literal, setForm-spread) — they prove the AST detector
 * catches the regression regardless of formatting, not just one literal form.
 * Plus negatives (initializers must NOT flag), content-anchoring properties,
 * and the duplicate-count guard.
 */
import { describe, it, expect } from 'vitest';
import {
  detectClears,
  anchorFor,
  runGuard,
  PROTECTED_FIELDS,
} from '../../scripts/check-no-silent-rep-clears.mjs';

describe('silent-rep-clear guard — the 4 incidents, as distinct code shapes', () => {
  it('2026-04-22 Tyson — single-line update()', () => {
    const src = "onChange={() => { update('repId', x); update('setterId', ''); }}";
    const hits = detectClears(src).filter((c) => c.field === 'setterId');
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('update-clear');
  });

  it('2026-04-26 Melissa — MULTILINE update() (regex would miss this)', () => {
    const src = ['update(', "  'setterId',", "  '',", ')'].join('\n');
    const hits = detectClears(src).filter((c) => c.field === 'setterId');
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('update-clear');
  });

  it('2026-05-11 Hunter — TEMPLATE-LITERAL empty (regex would miss this)', () => {
    const src = 'update(`setterId`, ``)';
    const hits = detectClears(src).filter((c) => c.field === 'setterId');
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('update-clear');
  });

  it('2026-05-23 Patrick — setForm spread clear', () => {
    const src = "setForm((prev) => ({ ...prev, setterId: '' }));";
    const hits = detectClears(src).filter((c) => c.field === 'setterId');
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('object-clear');
  });

  it('covers all three protected fields', () => {
    for (const field of PROTECTED_FIELDS) {
      expect(detectClears(`update('${field}', '')`).some((c) => c.field === field)).toBe(true);
    }
  });
});

describe('silent-rep-clear guard — does NOT flag initializers', () => {
  it('useState({ setterId: "" }) default is not a clear', () => {
    const src = "const [f, setF] = useState({ setterId: '', repId: '' });";
    expect(detectClears(src)).toHaveLength(0);
  });

  it('a complete initial-state object literal (no spread) is not a clear', () => {
    // This is the false-positive class the spread-requirement fixed: form
    // creation defaults, one field per line, no `...prev`.
    const src = ['const initialForm = {', "  notes: '',", "  setterId: '',", "  blitzId: '',", '};'].join('\n');
    expect(detectClears(src)).toHaveLength(0);
  });
});

describe('silent-rep-clear guard — content-anchoring (v2/v3)', () => {
  it('anchor is STABLE across unrelated line shifts (fixes the line-pin drift)', () => {
    const block = ['  // closer picker', '  onClick={() => {', "    update('blitzId', '');"];
    const before = anchorFor(block, 2);
    const shifted = ['', '', '', '', ...block]; // pushed down 4 lines by an edit above
    expect(anchorFor(shifted, 6)).toBe(before);
  });

  it('anchor uses non-blank context (blank lines do not shrink it)', () => {
    const tight = ['a();', 'b();', "update('blitzId', '');"];
    const spaced = ['a();', '', 'b();', '', "update('blitzId', '');"];
    expect(anchorFor(spaced, 4)).toBe(anchorFor(tight, 2));
  });

  it('anchor DISTINGUISHES identical statements in different handlers', () => {
    const closer = anchorFor(['onChange rep', '  // rep changed', "  update('blitzId', '')"], 2);
    const leadSrc = anchorFor(['lead source', '  if (val !== "blitz")', "  update('blitzId', '')"], 2);
    expect(closer).not.toBe(leadSrc);
  });
});

describe('silent-rep-clear guard — duplicate-count protection', () => {
  it('identical-context duplicate shares an anchor, so the count cap flags it', () => {
    // A copy-pasted handler block: both clears have identical statement AND
    // identical preceding context → identical anchor. allowlist count is 1, so
    // runGuard flags the 2nd occurrence (n=2 > allowed=1).
    const block = ['// pasted handler', 'onClick={() =>', "  update('setterId', '')}"];
    const src = [...block, ...block].join('\n');
    const hits = detectClears(src).filter((c) => c.field === 'setterId');
    expect(hits).toHaveLength(2);
    expect(hits[0].anchor).toBe(hits[1].anchor);
  });

  it('a duplicate placed in DIFFERENT context gets a fresh anchor (flagged as new)', () => {
    const a = anchorFor(['// handler A', 'onClick={() =>', "  update('setterId', '')}"], 2);
    const b = anchorFor(['// handler B', 'onClick={() =>', "  update('setterId', '')}"], 2);
    expect(a).not.toBe(b); // different surrounding code → not auto-allowlisted
  });
});

describe('silent-rep-clear guard — evasion shapes (hardening pass)', () => {
  const setterFlagged = (src: string) =>
    detectClears(src).filter((c) => c.field === 'setterId').length === 1;

  it('catches wrapped empties: parenthesized and as-const', () => {
    expect(setterFlagged("update('setterId', (''))")).toBe(true);
    expect(setterFlagged("update('setterId', '' as const)")).toBe(true);
  });

  it('catches string and computed object keys', () => {
    expect(setterFlagged("setForm((p) => ({ ...p, 'setterId': '' }))")).toBe(true);
    expect(setterFlagged("setForm((p) => ({ ...p, ['setterId']: '' }))")).toBe(true);
  });

  it('catches a useCallback clear factory (not treated as an initializer)', () => {
    expect(setterFlagged('const f = useCallback((p) => ({ ...p, setterId: \'\' }), []);')).toBe(true);
  });

  it('does NOT flag { field: "", ...prev } (spread overwrites the field back)', () => {
    expect(detectClears("setForm((p) => ({ setterId: '', ...p }));")).toHaveLength(0);
  });

  it('does NOT flag a useState initializer even when it spreads defaults', () => {
    expect(detectClears("const [f, setF] = useState({ ...defaults, setterId: '' });")).toHaveLength(0);
  });
});

describe('silent-rep-clear guard — live tree', () => {
  it('the real protected forms currently have zero unallowlisted clears', () => {
    const { violations, audited } = runGuard();
    expect(audited).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });
});
