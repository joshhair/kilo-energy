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

  const headerContent = (
    <div className="flex items-center gap-2">
      <h2 className="tracking-widest uppercase" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)", fontSize: '0.75rem', fontWeight: 500 }}>{title}</h2>
      {count !== undefined && (
        <span className="px-2 py-0.5 rounded-full text-base" style={{ background: 'rgba(0,229,160,0.1)', color: 'var(--m-accent, #00e5a0)', fontSize: '0.7rem', fontWeight: 600 }}>{count}</span>
      )}
    </div>
  );

  return (
    <div>
      {collapsible ? (
        <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between mb-3 min-h-[48px]">
          {headerContent}
          {open ? <ChevronUp className="w-5 h-5" style={{ color: 'var(--m-text-dim, #445577)' }} /> : <ChevronDown className="w-5 h-5" style={{ color: 'var(--m-text-dim, #445577)' }} />}
        </button>
      ) : (
        <div className="flex items-center gap-2 mb-3">
          {headerContent}
        </div>
      )}
      {(!collapsible || open) && children}
    </div>
  );
}
