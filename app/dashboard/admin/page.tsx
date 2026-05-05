'use client';

import Link from 'next/link';
import { useApp } from '../../../lib/context';
import { ScrollText, Calculator, Settings } from 'lucide-react';

export default function AdminHubPage() {
  const { effectiveRole } = useApp();

  if (effectiveRole !== 'admin') {
    return (
      <div className="p-8 text-center">
        <p className="text-[var(--text-muted)] text-sm">Admin only.</p>
      </div>
    );
  }

  const tools = [
    {
      href: '/dashboard/admin/audit',
      icon: ScrollText,
      title: 'Audit Log',
      description: 'Who changed what and when. Filter by entity, actor, date range.',
    },
    {
      href: '/dashboard/admin/commission-playground',
      icon: Calculator,
      title: 'Commission Playground',
      description: 'Sandbox the commission math with arbitrary inputs. Useful for verifying expected payouts before a real deal.',
    },
    {
      href: '/dashboard/settings',
      icon: Settings,
      title: 'Settings',
      description: 'Installers, financers, product catalog, pricing versions, trainers.',
    },
  ];

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-black tracking-tight" style={{ fontFamily: "'DM Serif Display', serif", letterSpacing: '-0.03em' }}>
          Admin
        </h1>
        <p className="text-[var(--text-secondary)] text-sm mt-1">Operational tools for system admins.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {tools.map((t) => {
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              className="card-surface rounded-2xl p-5 hover:border-[var(--accent-cyan-solid)]/30 transition-colors group"
            >
              <div className="w-10 h-10 rounded-xl bg-[var(--accent-cyan-solid)]/10 flex items-center justify-center mb-3 group-hover:bg-[var(--accent-cyan-solid)]/20 transition-colors">
                <Icon className="w-5 h-5 text-[var(--accent-cyan-text)]" />
              </div>
              <h2 className="text-[var(--text-primary)] font-semibold mb-1.5">{t.title}</h2>
              <p className="text-[var(--text-muted)] text-xs leading-relaxed">{t.description}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
