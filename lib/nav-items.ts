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
  DollarSign,
  Banknote,
  Users,
  Settings,
  CreditCard,
  Calculator,
  Receipt,
  Trophy,
  Vault,
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
  { href: '/dashboard/vault',      label: 'My Pay',     icon: Vault },
  { href: '/dashboard/calculator', label: 'Calculator',  icon: Calculator },
];

// ─── Admin navigation ────────────────────────────────────────────────────────

export const ADMIN_NAV: AnyNavItem[] = [
  { href: '/dashboard',              label: 'Dashboard',  icon: LayoutDashboard },
  { href: '/dashboard/new-deal',     label: 'New Deal',   icon: PlusCircle },
  { href: '/dashboard/projects',     label: 'Projects',   icon: FolderKanban },
  { href: '/dashboard/payroll',      label: 'Payroll',    icon: CreditCard },
  { href: '/dashboard/calculator',   label: 'Calculator', icon: Calculator },
  { href: '/dashboard/reps',         label: 'Reps',       icon: Users },
  { href: '/dashboard/incentives',   label: 'Incentives', icon: Trophy },
  { href: '/dashboard/settings',     label: 'Settings',   icon: Settings },
];
