'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

export default function MobileSection({
  title,
  children,
  collapsible = false,
  defaultOpen = true,
  count,
  divider = true,
}: {
  title: string;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  count?: number;
  divider?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      {divider && (
        <div className="h-px bg-gradient-to-r from-transparent via-slate-700/40 to-transparent mb-4" />
      )}
      {collapsible ? (
        <button
          onClick={() => setOpen(!open)}
          className="w-full flex items-center justify-between mb-4 min-h-[36px]"
        >
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{title}</h2>
            {count !== undefined && (
              <span className="text-[10px] font-bold bg-slate-800 text-slate-400 rounded-full px-2 py-0.5">{count}</span>
            )}
          </div>
          {open ? <ChevronUp className="w-4 h-4 text-slate-600" /> : <ChevronDown className="w-4 h-4 text-slate-600" />}
        </button>
      ) : (
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{title}</h2>
          {count !== undefined && (
            <span className="text-[10px] font-bold bg-slate-800 text-slate-400 rounded-full px-2 py-0.5">{count}</span>
          )}
        </div>
      )}
      {(!collapsible || open) && children}
    </div>
  );
}
