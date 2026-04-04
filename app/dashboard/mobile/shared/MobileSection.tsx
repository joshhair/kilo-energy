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
          className="w-full flex items-center justify-between mb-2 min-h-[48px]"
        >
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-slate-400 uppercase tracking-wider">{title}</h2>
            {count !== undefined && (
              <span className="text-base text-slate-500">{count}</span>
            )}
          </div>
          {open ? <ChevronUp className="w-5 h-5 text-slate-500" /> : <ChevronDown className="w-5 h-5 text-slate-500" />}
        </button>
      ) : (
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-base font-semibold text-slate-400 uppercase tracking-wider">{title}</h2>
          {count !== undefined && (
            <span className="text-base text-slate-500">{count}</span>
          )}
        </div>
      )}
      {(!collapsible || open) && children}
    </div>
  );
}
