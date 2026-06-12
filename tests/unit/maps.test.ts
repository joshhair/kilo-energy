import { describe, it, expect } from 'vitest';
import { mapsHref } from '../../lib/maps';

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15';
const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126';

describe('mapsHref', () => {
  it('returns null when every part is empty', () => {
    expect(mapsHref([], WIN_UA)).toBeNull();
    expect(mapsHref(['', '  ', undefined, null], WIN_UA)).toBeNull();
  });

  it('uses Apple Maps for Apple user agents', () => {
    expect(mapsHref(['123 Main St', 'Austin, TX'], IOS_UA)).toBe(
      `https://maps.apple.com/?q=${encodeURIComponent('123 Main St, Austin, TX')}`,
    );
  });

  it('uses Google Maps elsewhere', () => {
    expect(mapsHref(['123 Main St'], WIN_UA)).toBe(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('123 Main St')}`,
    );
  });

  it('dedupes a comma-delimited trailing city suffix', () => {
    const href = mapsHref(['123 Main St, Austin, TX', 'Austin, TX'], WIN_UA);
    expect(href).toContain(encodeURIComponent('123 Main St, Austin, TX'));
    expect(href).not.toContain(encodeURIComponent('123 Main St, Austin, TX, Austin, TX'));
  });

  it('does NOT drop a city that merely appears inside the street name', () => {
    // "12 Austin Street" + "Austin" must keep the city — substring dedupe
    // would route the pin to whatever city the geocoder guesses (Codex).
    const href = mapsHref(['12 Austin Street', 'Austin'], WIN_UA);
    expect(href).toContain(encodeURIComponent('12 Austin Street, Austin'));
  });

  it('trims whitespace parts', () => {
    expect(mapsHref(['  123 Main St  '], WIN_UA)).toContain(encodeURIComponent('123 Main St'));
  });
});
