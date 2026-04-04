'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

export default function MobileSection({
  title,
  children,
  collapsible = false,
  defaultOpen = true,
  count,
}: {
  title: string;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  count?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      {collapsible ? (
        <button
          onClick={() => setOpen(!open)}
          className="w-full flex items-center justify-between mb-3 min-h-[48px]"
        >
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">{title}</h2>
            {count !== undefined && (
              <span className="text-sm text-slate-600">{count}</span>
            )}
          </div>
          {open ? <ChevronUp className="w-4 h-4 text-slate-600" /> : <ChevronDown className="w-4 h-4 text-slate-600" />}
        </button>
      ) : (
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">{title}</h2>
          {count !== undefined && (
            <span className="text-sm text-slate-600">{count}</span>
          )}
        </div>
      )}
      {(!collapsible || open) && children}
    </div>
  );
}
