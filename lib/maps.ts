/**
 * mapsHref — build a maps deep-link for a blitz address (Josh's blitz
 * feedback, 2026-06-12: "Location should be clickable").
 *
 * Apple Maps for Apple platforms (the reps' iPhone PWA), Google Maps
 * elsewhere. Pure + testable: pass the UA explicitly in tests; falls back
 * to navigator.userAgent in the browser. Returns null when there is
 * nothing to query (callers render plain text in that case).
 */
export function mapsHref(
  parts: Array<string | null | undefined>,
  ua?: string,
): string | null {
  const cleaned: string[] = [];
  for (const raw of parts) {
    const p = (raw ?? '').trim();
    if (!p) continue;
    // Dedupe ONLY exact matches or a comma-delimited trailing suffix
    // ("123 Main St, Austin, TX" + "Austin, TX"). Substring containment
    // would wrongly drop the city for "12 Austin Street" + "Austin",
    // sending the query to whatever city the geocoder guesses (Codex).
    const lower = p.toLowerCase();
    const dup = cleaned.some((c) => {
      const cl = c.toLowerCase();
      return cl === lower || cl.endsWith(`, ${lower}`);
    });
    if (dup) continue;
    cleaned.push(p);
  }
  if (cleaned.length === 0) return null;
  const query = encodeURIComponent(cleaned.join(', '));
  const agent = ua ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  const isApple = /iPhone|iPad|iPod|Macintosh/.test(agent);
  return isApple
    ? `https://maps.apple.com/?q=${query}`
    : `https://www.google.com/maps/search/?api=1&query=${query}`;
}
