'use client';

import Link from 'next/link';
import { ChevronRight, ChevronLeft } from 'lucide-react';

interface BreadcrumbProps {
  items: Array<{ label: string; href?: string }>;
}

export function Breadcrumb({ items }: BreadcrumbProps) {
  if (items.length < 2) return null;

  const previous = items[items.length - 2];

  return (
    <>
      {/* Mobile: show "< Back to [Previous]" */}
      <nav className="sm:hidden mb-3" aria-label="Breadcrumb">
        {previous.href ? (
          <Link
            href={previous.href}
            className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            <ChevronLeft className="w-3 h-3" />
            Back to {previous.label}
          </Link>
        ) : (
          <span className="text-xs text-slate-500">{previous.label}</span>
        )}
      </nav>

      {/* Desktop: full breadcrumb trail */}
      <nav className="hidden sm:flex items-center gap-1.5 mb-3" aria-label="Breadcrumb">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <span key={i} className="inline-flex items-center gap-1.5">
              {i > 0 && <ChevronRight className="w-3 h-3 text-slate-600" />}
              {isLast || !item.href ? (
                <span className={`text-xs ${isLast ? 'text-slate-400' : 'text-slate-500'}`}>
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href}
                  className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {item.label}
                </Link>
              )}
            </span>
          );
        })}
      </nav>
    </>
  );
}
