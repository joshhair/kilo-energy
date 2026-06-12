/**
 * Role display metadata + the SimpleUser shape shared by the users page
 * and its extracted sections — moved verbatim from users/page.tsx
 * (T4.1, 2026-06-11).
 */

export type SimpleUser = {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  role: string;
  repType?: string;
  active?: boolean;
};

export const ROLE_LABELS = { closer: 'Closer', setter: 'Setter', both: 'Both' } as const;

// User account role labels (for the Add User modal role picker).
export const ROLE_LABELS_BY_ROLE: Record<'rep' | 'admin' | 'sub-dealer' | 'project_manager', string> = {
  rep: 'Rep',
  admin: 'Admin',
  'sub-dealer': 'Sub-Dealer',
  project_manager: 'Project Manager',
};
export const ROLE_BADGE_CLS = {
  closer: 'border',
  setter: 'border',
  both:   'border',
} as const;
export const ROLE_BADGE_STYLES = {
  closer: { background: 'var(--accent-blue-soft)', color: 'var(--accent-blue-text)', borderColor: 'color-mix(in srgb, var(--accent-blue-solid) 25%, transparent)' },
  setter: { background: 'color-mix(in srgb, var(--accent-purple-solid) 10%, transparent)', color: 'var(--accent-purple-text)', borderColor: 'color-mix(in srgb, var(--accent-purple-solid) 25%, transparent)' },
  both:   { background: 'color-mix(in srgb, var(--accent-cyan-solid) 10%, transparent)', color: 'var(--accent-cyan-text)', borderColor: 'color-mix(in srgb, var(--accent-cyan-solid) 25%, transparent)' },
} as const;
export const ROLE_BADGE_HOVER = {
  closer: 'hover:brightness-125',
  setter: 'hover:brightness-125',
  both:   'hover:brightness-125',
} as const;
