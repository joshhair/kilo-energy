'use client';
import { useState } from 'react';
import { ClipboardCopy, Share2, Link2, Check } from 'lucide-react';

interface CalcShareBarProps {
  onCopy: () => void;
  onShare: () => void;
  onShareURL: () => void;
}

const btnBase = 'flex items-center gap-2 min-h-[44px] px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-100 active:scale-[0.93]';

export default function CalcShareBar({ onCopy, onShare, onShareURL }: CalcShareBarProps) {
  const [flashedKey, setFlashedKey] = useState<'copy' | 'share' | 'link' | null>(null);

  const flash = (key: typeof flashedKey, fn: () => void) => {
    fn();
    setFlashedKey(key);
    setTimeout(() => setFlashedKey(null), 1200);
  };

  const activeStyle = { color: 'var(--accent-emerald-text)', borderColor: 'var(--accent-emerald-solid)', background: 'var(--accent-emerald-soft)' };
  const idleStyle = { background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' };

  return (
    <div className="flex gap-2 mt-4">
      <button type="button" onClick={() => flash('copy', onCopy)} title="Copy deal summary"
        className={btnBase} style={flashedKey === 'copy' ? activeStyle : idleStyle}>
        {flashedKey === 'copy' ? <Check className="w-4 h-4 flex-shrink-0" /> : <ClipboardCopy className="w-4 h-4 flex-shrink-0" />} Copy
      </button>
      <button type="button" onClick={() => flash('share', onShare)} title="Copy share summary"
        className={btnBase} style={flashedKey === 'share' ? activeStyle : idleStyle}>
        {flashedKey === 'share' ? <Check className="w-4 h-4 flex-shrink-0" /> : <Share2 className="w-4 h-4 flex-shrink-0" />} Share
      </button>
      <button type="button" onClick={() => flash('link', onShareURL)} title="Copy shareable URL"
        className={btnBase} style={flashedKey === 'link' ? activeStyle : idleStyle}>
        {flashedKey === 'link' ? <Check className="w-4 h-4 flex-shrink-0" /> : <Link2 className="w-4 h-4 flex-shrink-0" />} Link
      </button>
    </div>
  );
}
