import Link from 'next/link';
import { ReactNode } from 'react';

export default function LegalLayout({ children }: { children: ReactNode }) {
  const year = new Date().getFullYear();
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'linear-gradient(135deg, #03060c 0%, #050b18 50%, #0a1830 100%)' }}
    >
      <header className="px-6 py-5 border-b border-white/5">
        <Link href="/" className="inline-flex items-baseline gap-1.5">
          <span className="text-[var(--text-primary)] font-black tracking-tight" style={{ fontSize: '1.5rem', letterSpacing: '-0.05em' }}>kilo</span>
          <span className="text-[var(--text-primary)] font-light tracking-[0.32em] uppercase text-xs">ENERGY</span>
        </Link>
      </header>
      <main className="flex-1 max-w-3xl w-full mx-auto px-6 py-12">
        <article
          className="prose prose-invert max-w-none"
          style={{ color: 'rgba(255,255,255,0.85)' }}
        >
          {children}
        </article>
      </main>
      <footer className="px-6 py-6 border-t border-white/5 flex flex-wrap gap-4 text-xs text-[var(--text-primary)]/40">
        <Link href="/legal/privacy" className="hover:text-[var(--text-primary)]/80">Privacy</Link>
        <Link href="/legal/terms" className="hover:text-[var(--text-primary)]/80">Terms</Link>
        <span className="ml-auto">© {year} Kilo Energy</span>
      </footer>
    </div>
  );
}
