'use client';

/**
 * AddressVerifyField — housing/address input with an explicit "Verify"
 * action (Josh's blitz feedback: "when putting the address in, it should
 * do an address verification pull up to select the actual address").
 *
 * ONE-SHOT verification by design: the user types, taps Verify, and picks
 * from real geocoded addresses. NOT a debounced typeahead — the upstream
 * OSM Nominatim policy forbids autocomplete-style use; the request goes
 * through our authed, rate-limited /api/geocode proxy.
 *
 * Result rows are IN FLOW below the input (no portal/fixed positioning —
 * the chatter keyboard lessons), select on pointerdown-preventDefault so
 * the iOS keyboard never dismisses, with a guarded onClick for keyboard/
 * assistive activation. Escape closes the results.
 */

import { useState } from 'react';
import { Loader2, MapPin } from 'lucide-react';

interface GeocodeResult {
  displayName: string;
  city: string;
  state: string;
}

export function AddressVerifyField({ value, onChange, onCityFound, inputClassName, inputStyle, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  /** Called with the verified city ("Austin") so callers can offer it to an empty location field. */
  onCityFound?: (city: string) => void;
  inputClassName: string;
  inputStyle?: React.CSSProperties;
  placeholder?: string;
}) {
  const [verifying, setVerifying] = useState(false);
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [error, setError] = useState('');

  const verify = async () => {
    const q = value.trim();
    if (q.length < 4 || verifying) return;
    setVerifying(true);
    setError('');
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setResults(Array.isArray(data?.results) ? data.results : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed');
      setResults(null);
    } finally {
      setVerifying(false);
    }
  };

  const select = (r: GeocodeResult) => {
    if (results === null) return; // idempotence guard (pointerdown + click)
    onChange(r.displayName);
    if (r.city && onCityFound) onCityFound(r.city);
    setResults(null);
  };

  return (
    <div>
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => { onChange(e.target.value); setResults(null); setError(''); }}
          onKeyDown={(e) => { if (e.key === 'Escape') setResults(null); }}
          placeholder={placeholder}
          className={`${inputClassName} flex-1 min-w-0`}
          style={inputStyle}
        />
        <button
          type="button"
          // preventDefault on pointerdown keeps focus (and the iOS keyboard)
          // in the input while the results load — same trick as the rows.
          onPointerDown={(e) => e.preventDefault()}
          onClick={verify}
          disabled={value.trim().length < 4 || verifying}
          className="shrink-0 min-h-[48px] px-3 rounded-lg text-sm font-medium disabled:opacity-40 text-[var(--accent-emerald-text)] border border-[var(--accent-emerald-solid)]/30 active:scale-[0.96] transition-transform"
          aria-label="Verify address"
        >
          {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Verify'}
        </button>
      </div>
      {error && <p className="text-xs mt-1.5 text-[var(--accent-red-text)]">{error}</p>}
      {results !== null && (
        <div className="mt-2 rounded-lg border border-[var(--border-subtle)] overflow-hidden">
          <div className="max-h-48 overflow-y-auto">
            {results.length === 0 && (
              <p className="text-xs px-3 py-2.5 text-[var(--text-dim)]">No matches — check the address and try again.</p>
            )}
            {results.map((r, i) => (
              <button
                key={i}
                type="button"
                onPointerDown={(e) => { e.preventDefault(); select(r); }}
                onClick={() => select(r)}
                className="w-full text-left flex items-start gap-2 px-3 py-2.5 min-h-[44px] text-sm text-[var(--text-primary)] border-b border-[var(--border-subtle)]/60 last:border-b-0 active:bg-[var(--surface-card)]"
              >
                <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: 'var(--text-dim)' }} />
                <span>{r.displayName}</span>
              </button>
            ))}
          </div>
          <p className="text-[10px] px-3 py-1.5 text-[var(--text-dim)] bg-[var(--surface-card)]/50">© OpenStreetMap contributors</p>
        </div>
      )}
    </div>
  );
}
