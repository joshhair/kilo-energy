/**
 * Canonical ordering for user pickers, management lists, and reference data.
 *
 * Three rules, one utility so every surface uses the same signal:
 *
 *   sortForSelection    — user pickers (new-deal closer/setter, trainer
 *                         assignment, reimbursement rep, incentive target).
 *                         Active-only, alphabetical by first name.
 *                         Rationale: reps refer to each other by first name
 *                         when picking from a list.
 *
 *   sortForManagement   — admin lists (Users page, Training page, payroll
 *                         rep filter). Active first, then inactive,
 *                         alphabetical by last name within each group.
 *                         Rationale: admin work is scan-then-find; grouping
 *                         inactives at the bottom is fast to skip past.
 *
 *   sortReferenceData   — installers, products. Alphabetical by name.
 *                         Financers: "Cash" pinned first, then alphabetical
 *                         (Cash is the most common pick on Cash-type deals).
 *
 * Metric-sorted surfaces (leaderboards, Top Performers, Commission by Role,
 * Profitability) intentionally do NOT use these helpers — their purpose is
 * the metric ordering.
 */

type UserLike = {
  firstName?: string;
  lastName?: string;
  name?: string;
  active?: boolean;
};

function firstNameKey(u: UserLike): string {
  // Prefer firstName; fall back to the first token of `name`. Lowercased
  // for case-insensitive compare; empty string sorts last.
  const fn = (u.firstName ?? u.name?.split(' ')[0] ?? '').trim().toLowerCase();
  return fn || '\uffff';
}

function lastNameKey(u: UserLike): string {
  // Prefer lastName; fall back to the last token of `name`.
  const parts = (u.name ?? '').trim().split(/\s+/).filter(Boolean);
  const ln = (u.lastName ?? parts[parts.length - 1] ?? '').trim().toLowerCase();
  return ln || '\uffff';
}

/** Picker dropdowns. Active-only, alphabetical by first name. */
export function sortForSelection<T extends UserLike>(users: ReadonlyArray<T>): T[] {
  return [...users]
    .filter((u) => u.active !== false)
    .sort((a, b) => {
      const af = firstNameKey(a);
      const bf = firstNameKey(b);
      if (af !== bf) return af < bf ? -1 : 1;
      // Tiebreak on last name so two Chrises are deterministic.
      const al = lastNameKey(a);
      const bl = lastNameKey(b);
      return al < bl ? -1 : al > bl ? 1 : 0;
    });
}

/** Admin management lists. Active first, then inactive; alpha by last name within each group. */
export function sortForManagement<T extends UserLike>(users: ReadonlyArray<T>): T[] {
  return [...users].sort((a, b) => {
    const aActive = a.active !== false;
    const bActive = b.active !== false;
    if (aActive !== bActive) return aActive ? -1 : 1;
    const al = lastNameKey(a);
    const bl = lastNameKey(b);
    if (al !== bl) return al < bl ? -1 : 1;
    const af = firstNameKey(a);
    const bf = firstNameKey(b);
    return af < bf ? -1 : af > bf ? 1 : 0;
  });
}

type Named = { name: string; active?: boolean };

/** Installers, products, etc. Alphabetical by name, inactive rows kept (caller can pre-filter). */
export function sortReferenceData<T extends Named>(items: ReadonlyArray<T>): T[] {
  return [...items].sort((a, b) => {
    const an = (a.name ?? '').trim().toLowerCase();
    const bn = (b.name ?? '').trim().toLowerCase();
    return an < bn ? -1 : an > bn ? 1 : 0;
  });
}

/** Financers. Same as reference data but with "Cash" pinned first — it's
 *  the most common default for Cash-type deals, so users shouldn't have to
 *  scroll past C-names to find it. */
export function sortFinancers<T extends Named>(items: ReadonlyArray<T>): T[] {
  return [...items].sort((a, b) => {
    const an = (a.name ?? '').trim().toLowerCase();
    const bn = (b.name ?? '').trim().toLowerCase();
    if (an === 'cash') return bn === 'cash' ? 0 : -1;
    if (bn === 'cash') return 1;
    return an < bn ? -1 : an > bn ? 1 : 0;
  });
}
