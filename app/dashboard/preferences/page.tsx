'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { useMediaQuery } from '../../../lib/hooks';
import AppearanceSection from '../settings/sections/AppearanceSection';

export default function PreferencesPage() {
  const isMobile = useMediaQuery('(max-width: 767px)');
  useEffect(() => { document.title = 'Preferences | Kilo Energy'; }, []);

  return (
    <div
      className="px-5 pt-4 pb-24 md:p-8 max-w-3xl space-y-5 animate-fade-in-up"
      style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
    >
      {isMobile && (
        <Link
          href="/dashboard/you"
          className="inline-flex items-center gap-1.5 text-sm"
          style={{ color: 'var(--text-muted)', WebkitTapHighlightColor: 'transparent' }}
        >
          <ChevronLeft className="w-4 h-4" />
          Back
        </Link>
      )}

      <div className="flex items-center justify-between">
        <h1
          style={{
            fontFamily: "var(--m-font-display, 'DM Serif Display', serif)",
            fontSize: 'clamp(1.6rem, 4vw, 2rem)',
            color: 'var(--text-primary)',
          }}
        >
          Preferences
        </h1>
      </div>

      <AppearanceSection />
    </div>
  );
}
