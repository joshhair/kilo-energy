/**
 * Blitz status derivation.
 *
 * The Blitz.status column stores one of: 'upcoming' | 'active' |
 * 'completed' | 'cancelled'. Historically the value was set at blitz
 * creation (usually 'upcoming') and only transitioned manually — which
 * meant a blitz whose startDate had already arrived would keep saying
 * "Upcoming" until someone flipped it by hand.
 *
 * This helper derives the effective status from the stored value + the
 * current date:
 *
 *   - 'cancelled' or 'completed' → always respected (manual terminal).
 *   - otherwise derived from dates:
 *        today  < startDate     → 'upcoming'
 *        startDate <= today <= endDate → 'active'
 *        today  > endDate       → 'completed'
 *
 * `cancelled` stays as a human-driven terminal state because a blitz
 * can be cancelled before or during its window.
 */

export type BlitzStatus = 'upcoming' | 'active' | 'completed' | 'cancelled';

export interface BlitzForStatus {
  status: string;
  startDate?: string | null;   // YYYY-MM-DD
  endDate?: string | null;     // YYYY-MM-DD
}

/** Returns a string compare-safe YYYY-MM-DD for local "today". */
function todayLocalDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Derive effective blitz status. `cancelled` and `completed` from the
 * DB are treated as terminal and passed through. Any other stored
 * value is recomputed against the current date — so a blitz with
 * startDate=today shows 'active' even if the DB column still says
 * 'upcoming' from when it was created.
 */
export function deriveBlitzStatus(
  blitz: BlitzForStatus,
  asOf: string = todayLocalDateStr(),
): BlitzStatus {
  if (blitz.status === 'cancelled') return 'cancelled';
  if (blitz.status === 'completed') return 'completed';

  // Ambiguous / missing dates → fall back to the stored status. Keeps
  // behavior safe for legacy rows without both dates.
  if (!blitz.startDate || !blitz.endDate) {
    return (blitz.status as BlitzStatus) || 'upcoming';
  }

  if (asOf < blitz.startDate) return 'upcoming';
  if (asOf > blitz.endDate) return 'completed';
  return 'active';
}
