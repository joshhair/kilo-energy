/**
 * validation.ts — shared input validators.
 *
 * Single source of truth for the form-input validation rules used
 * across every admin surface. Replaces the previous "each Settings
 * section reimplements its own trim/dup-check/format validation"
 * pattern that produced subtly different rejection rules in
 * different places.
 *
 * Every validator returns the same discriminated shape:
 *
 *   { ok: true, value: T }      — input passed; `value` is the
 *                                 normalized form ready to persist
 *   { ok: false, reason: string } — input failed; `reason` is admin-
 *                                   friendly copy for a toast or
 *                                   inline error
 *
 * Callers branch on `.ok` and render or persist accordingly. No
 * thrown exceptions; validation failure is data, not control flow.
 *
 * Adding a new validator:
 * - Match the result shape exactly (ok-discriminated).
 * - Always normalize before checking duplicates (NFC for strings,
 *   case-fold where the domain calls for it).
 * - Reject control characters, zero-width characters, and any
 *   homograph attack vector (Punycode, mixed scripts) BEFORE other
 *   checks. Invisible chars are how admins accidentally create
 *   "Goodleap" and "Goodleap​" as separate financers.
 * - Provide an admin-friendly reason string. Mention what was
 *   detected ("Name contains zero-width characters") so the admin
 *   knows what to fix. Don't leak internal regex details.
 * - Add a property-based fast-check test in
 *   tests/unit/validation.test.ts.
 */

export type ValidationOk<T> = { ok: true; value: T };
export type ValidationErr = { ok: false; reason: string };
export type ValidationResult<T> = ValidationOk<T> | ValidationErr;

const CONTROL_OR_SEPARATOR_RE = /[\u0000-\u001F\u007F]/;
const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/;

/** Normalize a string for storage: NFC-normalize and trim. */
export function normalizeString(raw: string): string {
  return raw.normalize('NFC').trim();
}

/** True iff the string contains characters that are invisible to humans
 *  but distinct in code points — i.e. would defeat dup detection. */
function hasInvisibleChars(s: string): { hasControl: boolean; hasZeroWidth: boolean } {
  return {
    hasControl: CONTROL_OR_SEPARATOR_RE.test(s),
    hasZeroWidth: ZERO_WIDTH_RE.test(s),
  };
}

// ────────────────────────────────────────────────────────────────────
// Names — products, installers, financers, sub-dealers, PMs, users.
// ────────────────────────────────────────────────────────────────────

export interface NameValidationOpts<TSibling extends { id: string; name: string }> {
  /** The current name of the entity being edited. Pass when renaming
   *  so a no-op rename (same value re-typed) accepts cleanly. Omit on
   *  initial create. */
  currentName?: string;
  /** Other entities in the same uniqueness scope (same family, same
   *  installer, etc.). Pass an empty array to disable dup detection;
   *  omit to disable entirely. */
  siblings?: ReadonlyArray<TSibling>;
  /** ID of the entity being edited; sibling with matching id is
   *  excluded from dup detection. Required when `siblings` is set. */
  currentId?: string;
  /** Min character length. Default 1 (rejects empty after trim). */
  minLength?: number;
  /** Max character length. Default 200. */
  maxLength?: number;
}

/**
 * The universal name validator. Use for product names, installer
 * names, financer names, sub-dealer names, PM display names, etc.
 *
 * Catches in order:
 *   1. After NFC-normalize + trim, the result is empty
 *   2. Contains control characters (\\x00–\\x1F, \\x7F)
 *   3. Contains zero-width characters (U+200B–200D, U+FEFF)
 *   4. Length out of bounds (default min 1, max 200)
 *   5. Duplicates an existing sibling (case-insensitive after NFC),
 *      excluding the entity being edited
 */
export function validateName<TSibling extends { id: string; name: string }>(
  raw: string,
  opts: NameValidationOpts<TSibling> = {},
): ValidationResult<string> {
  const minLength = opts.minLength ?? 1;
  const maxLength = opts.maxLength ?? 200;
  const normalized = normalizeString(raw);

  if (normalized.length < minLength) {
    return { ok: false, reason: minLength === 1 ? 'Name cannot be empty' : `Name must be at least ${minLength} characters` };
  }
  if (normalized.length > maxLength) {
    return { ok: false, reason: `Name must be at most ${maxLength} characters` };
  }

  const invisible = hasInvisibleChars(normalized);
  if (invisible.hasControl) {
    return { ok: false, reason: 'Name contains invisible control characters' };
  }
  if (invisible.hasZeroWidth) {
    return { ok: false, reason: 'Name contains zero-width characters' };
  }

  // No-op rename — short-circuit before checking duplicates.
  if (opts.currentName !== undefined && normalized === opts.currentName) {
    return { ok: true, value: normalized };
  }

  if (opts.siblings && opts.siblings.length > 0) {
    const lower = normalized.toLowerCase();
    const dup = opts.siblings.find((s) =>
      s.id !== opts.currentId && s.name.normalize('NFC').toLowerCase() === lower,
    );
    if (dup) {
      return { ok: false, reason: `Another entry is already named "${normalized}"` };
    }
  }

  return { ok: true, value: normalized };
}

// ────────────────────────────────────────────────────────────────────
// Email
// ────────────────────────────────────────────────────────────────────

export interface EmailValidationOpts<TSibling extends { id: string; email: string }> {
  currentEmail?: string;
  siblings?: ReadonlyArray<TSibling>;
  currentId?: string;
}

/**
 * Validate + normalize an email address. Lowercases for comparison
 * (standard practice; mailbox-spec technically allows case-sensitive
 * locals but no real-world provider does). Trims, NFC-normalizes,
 * rejects control chars + zero-width chars.
 *
 * Format check: present "@", at least one dot in the domain, no
 * leading/trailing whitespace internal. Liberal regex — rejecting
 * legal RFC addresses is worse than accepting a typo.
 */
export function validateEmail<TSibling extends { id: string; email: string }>(
  raw: string,
  opts: EmailValidationOpts<TSibling> = {},
): ValidationResult<string> {
  const normalized = normalizeString(raw).toLowerCase();
  if (normalized.length === 0) return { ok: false, reason: 'Email cannot be empty' };
  if (normalized.length > 254) return { ok: false, reason: 'Email is too long' };

  const invisible = hasInvisibleChars(normalized);
  if (invisible.hasControl || invisible.hasZeroWidth) {
    return { ok: false, reason: 'Email contains invalid invisible characters' };
  }
  // Liberal format check: name@domain.tld with no whitespace.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return { ok: false, reason: 'Email format is not valid' };
  }

  if (opts.currentEmail !== undefined && normalized === opts.currentEmail.toLowerCase()) {
    return { ok: true, value: normalized };
  }
  if (opts.siblings && opts.siblings.length > 0) {
    const dup = opts.siblings.find((s) =>
      s.id !== opts.currentId && s.email.toLowerCase().normalize('NFC') === normalized,
    );
    if (dup) return { ok: false, reason: `${normalized} is already registered` };
  }

  return { ok: true, value: normalized };
}

// ────────────────────────────────────────────────────────────────────
// Phone — US 10-digit assumption (matches the rest of the app)
// ────────────────────────────────────────────────────────────────────

export interface PhoneValidationOpts {
  /** Allow empty string as valid — useful where phone is optional. */
  allowEmpty?: boolean;
}

/**
 * Validate + normalize a US phone number to digits-only (10 digits;
 * leading "1" stripped). Empty input rejected unless allowEmpty.
 * Doesn't check existence — just shape.
 */
export function validatePhone(raw: string, opts: PhoneValidationOpts = {}): ValidationResult<string> {
  const normalized = normalizeString(raw);
  if (normalized.length === 0) {
    return opts.allowEmpty ? { ok: true, value: '' } : { ok: false, reason: 'Phone cannot be empty' };
  }
  // Strip everything except digits + leading +.
  const digits = normalized.replace(/[^\d]/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return { ok: true, value: digits.slice(1) };
  }
  if (digits.length === 10) return { ok: true, value: digits };
  return { ok: false, reason: 'Phone must be 10 digits (US)' };
}

// ────────────────────────────────────────────────────────────────────
// Amount in dollars — admin-input pricing, payroll edits, etc.
// ────────────────────────────────────────────────────────────────────

export interface AmountValidationOpts {
  min?: number;
  max?: number;
  /** When true, an explicit zero passes. Default: zero rejected
   *  (admins typically don't intentionally set $0 amounts; usually
   *  it's a typo). */
  allowZero?: boolean;
}

/** Validate + parse a dollar-amount string. Returns dollars as a
 *  number. Caller responsible for converting to cents at the storage
 *  boundary via lib/money. */
export function validateAmountDollars(raw: string, opts: AmountValidationOpts = {}): ValidationResult<number> {
  const min = opts.min ?? 0;
  const max = opts.max ?? Number.MAX_SAFE_INTEGER;
  const normalized = normalizeString(raw).replace(/[$,]/g, '');
  if (normalized.length === 0) return { ok: false, reason: 'Amount cannot be empty' };
  const parsed = parseFloat(normalized);
  if (!Number.isFinite(parsed)) return { ok: false, reason: 'Amount must be a number' };
  if (parsed === 0 && !opts.allowZero) return { ok: false, reason: 'Amount cannot be zero' };
  if (parsed < min) return { ok: false, reason: `Amount must be at least $${min.toFixed(2)}` };
  if (parsed > max) return { ok: false, reason: `Amount must be at most $${max.toFixed(2)}` };
  return { ok: true, value: parsed };
}

// ────────────────────────────────────────────────────────────────────
// Date — ISO YYYY-MM-DD
// ────────────────────────────────────────────────────────────────────

export interface DateValidationOpts {
  /** Earliest date allowed (inclusive). Pass 'today' for `new Date()`. */
  min?: string | 'today';
  /** Latest date allowed (inclusive). */
  max?: string;
  /** Allow dates before today. Default false — past dates surface as
   *  validation errors so admins don't silently rewrite history. */
  allowPast?: boolean;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

/** Validate + return ISO YYYY-MM-DD date string. */
export function validateDate(raw: string, opts: DateValidationOpts = {}): ValidationResult<string> {
  const normalized = normalizeString(raw);
  if (normalized.length === 0) return { ok: false, reason: 'Date cannot be empty' };
  if (!ISO_DATE_RE.test(normalized)) return { ok: false, reason: 'Date must be YYYY-MM-DD' };

  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return { ok: false, reason: 'Date is not valid' };

  if (!opts.allowPast) {
    const today = todayISO();
    if (normalized < today) return { ok: false, reason: 'Date cannot be in the past' };
  }
  if (opts.min !== undefined) {
    const minISO = opts.min === 'today' ? todayISO() : opts.min;
    if (normalized < minISO) return { ok: false, reason: `Date must be on or after ${minISO}` };
  }
  if (opts.max !== undefined && normalized > opts.max) {
    return { ok: false, reason: `Date must be on or before ${opts.max}` };
  }

  return { ok: true, value: normalized };
}
