/**
 * Shared navigation definitions.
 * Kept in a standalone module so both app/dashboard/layout.tsx and
 * lib/command-palette.tsx can import them without creating a circular dependency.
 */

import type { ComponentType } from 'react';
import {
  LayoutDashboard,
  PlusCircle,
  FolderKanban,
  Users,
  Settings,
  CreditCard,
  Calculator,
  Trophy,
  Wallet,
  Tent,
  GraduationCap,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────

export type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

export type NavGroupDef = {
  type: 'group';
  label: string;
  icon: ComponentType<{ className?: string }>;
  children: NavItem[];
};

export type AnyNavItem = NavItem | NavGroupDef;

// ─── Rep navigation ─────────────────────────────────────────────────────────

export const REP_NAV: AnyNavItem[] = [
  { href: '/dashboard',            label: 'Dashboard',  icon: LayoutDashboard },
  { href: '/dashboard/new-deal',   label: 'New Deal',   icon: PlusCircle },
  { href: '/dashboard/projects',   label: 'Projects',   icon: FolderKanban },
  { href: '/dashboard/my-pay',     label: 'My Pay',     icon: Wallet },
  { href: '/dashboard/blitz',     label: 'Blitz',      icon: Tent },
  { href: '/dashboard/training',   label: 'Training',    icon: GraduationCap },
  { href: '/dashboard/calculator', label: 'Calculator',  icon: Calculator },
];

// ─── Sub-dealer navigation ───────────────────────────────────────────────────

export const SUB_DEALER_NAV: AnyNavItem[] = [
  { href: '/dashboard',            label: 'Dashboard',  icon: LayoutDashboard },
  { href: '/dashboard/new-deal',   label: 'New Deal',   icon: PlusCircle },
  { href: '/dashboard/projects',   label: 'Projects',   icon: FolderKanban },
  { href: '/dashboard/my-pay',     label: 'My Pay',     icon: Wallet },
];

// ─── Project Manager navigation (base — configurable items added at runtime) ─

export const PM_NAV: AnyNavItem[] = [
  { href: '/dashboard',            label: 'Dashboard',  icon: LayoutDashboard },
  { href: '/dashboard/projects',   label: 'Projects',   icon: FolderKanban },
  { href: '/dashboard/users',      label: 'Users',      icon: Users },
];

// ─── Admin navigation ────────────────────────────────────────────────────────

export const ADMIN_NAV: AnyNavItem[] = [
  { href: '/dashboard',              label: 'Dashboard',  icon: LayoutDashboard },
  { href: '/dashboard/new-deal',     label: 'New Deal',   icon: PlusCircle },
  { href: '/dashboard/projects',     label: 'Projects',   icon: FolderKanban },
  { href: '/dashboard/payroll',      label: 'Payroll',    icon: CreditCard },
  { href: '/dashboard/calculator',   label: 'Calculator', icon: Calculator },
  { href: '/dashboard/users',        label: 'Users',      icon: Users },
  { href: '/dashboard/blitz',          label: 'Blitz',      icon: Tent },
  { href: '/dashboard/training',     label: 'Training',   icon: GraduationCap },
  { href: '/dashboard/incentives',   label: 'Incentives', icon: Trophy },
  { href: '/dashboard/settings',     label: 'Settings',   icon: Settings },
];
