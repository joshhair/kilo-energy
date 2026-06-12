import { NextRequest, NextResponse } from 'next/server';
import { requireInternalUser } from '../../../lib/api-auth';
import { enforceRateLimit } from '../../../lib/rate-limit';

// GET /api/geocode?q=<address> — ONE-SHOT address verification for the
// blitz create/edit forms ("type it, tap Verify, pick the real address").
//
// Proxies the public OSM Nominatim search API. Their usage policy FORBIDS
// autocomplete-style typeahead and requires app identification + modest
// volume — which is why this is an explicit user-initiated search behind
// auth + a per-user rate limit + a small in-memory cache, not a debounced
// keystroke endpoint. Attribution is rendered by the client next to the
// results (© OpenStreetMap contributors).
//
// Results are normalized to { displayName, city, state } —
// addressdetails=1 gives the structured fields so the client can offer
// to fill the blitz `location` (city) alongside `housing` (street).

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; results: GeocodeResult[] }>();

interface GeocodeResult {
  displayName: string;
  city: string;
  state: string;
}

interface NominatimRow {
  display_name?: string;
  address?: {
    city?: string; town?: string; village?: string; hamlet?: string;
    state?: string;
  };
}

export async function GET(req: NextRequest) {
  let user;
  try { user = await requireInternalUser(); } catch (r) { return r as NextResponse; }

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  if (q.length < 4) {
    return NextResponse.json({ error: 'Query too short' }, { status: 400 });
  }

  // One verification tap per form interaction is the expected shape —
  // 10/min per user is generous headroom for humans.
  const limited = await enforceRateLimit(`GET /api/geocode:${user.id}`, 10, 60_000);
  if (limited) return limited;

  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json({ results: hit.results, cached: true });
  }

  // Nominatim's policy caps the APPLICATION's total traffic (absolute max
  // 1 req/s), not per-user — a global throttle after the cache keeps the
  // whole app comfortably under it regardless of how many admins are
  // creating blitzes at once (Codex blocker). KV-backed, so it holds
  // across serverless instances.
  const globalLimited = await enforceRateLimit('GET /api/geocode:GLOBAL', 30, 60_000);
  if (globalLimited) return globalLimited;

  const upstream = new URL('https://nominatim.openstreetmap.org/search');
  upstream.searchParams.set('format', 'jsonv2');
  upstream.searchParams.set('q', q);
  upstream.searchParams.set('limit', '5');
  upstream.searchParams.set('countrycodes', 'us');
  upstream.searchParams.set('addressdetails', '1');

  let rows: NominatimRow[];
  try {
    const res = await fetch(upstream, {
      headers: {
        // Nominatim policy: identify the application.
        'User-Agent': 'kilo-energy-app/1.0 (blitz address verification)',
      },
      // Never let a slow upstream hang the form.
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Geocoder unavailable (${res.status})` }, { status: 502 });
    }
    rows = await res.json();
  } catch {
    return NextResponse.json({ error: 'Geocoder unavailable' }, { status: 502 });
  }

  const results: GeocodeResult[] = (Array.isArray(rows) ? rows : []).map((r) => ({
    displayName: r.display_name ?? '',
    city: r.address?.city ?? r.address?.town ?? r.address?.village ?? r.address?.hamlet ?? '',
    state: r.address?.state ?? '',
  })).filter((r) => r.displayName);

  cache.set(key, { at: Date.now(), results });
  return NextResponse.json({ results });
}
