import Link from 'next/link';

export default function NotFound() {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #03060c 0%, #060a14 60%, #060a14 100%)' }}
    >
      {/* Background grid */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />

      <div className="relative text-center space-y-6">
        {/* Logo */}
        <div className="inline-flex items-baseline gap-1">
          <span
            className="text-[var(--text-primary)] font-black tracking-tight leading-none"
            style={{ fontSize: '2.25rem', letterSpacing: '-0.04em' }}
          >
            kilo
          </span>
          <span
            className="text-[var(--text-primary)] font-light tracking-[0.25em] uppercase"
            style={{ fontSize: '0.85rem' }}
          >
            ENERGY
          </span>
        </div>

        {/* 404 */}
        <p
          className="text-[#525c72] font-black leading-none"
          style={{ fontSize: '8rem', letterSpacing: '-0.04em' }}
        >
          404
        </p>

        <div className="space-y-2">
          <h1 className="text-[var(--text-primary)] text-xl font-bold">Page Not Found</h1>
          <p className="text-[#8891a8] text-sm max-w-xs mx-auto">
            The page you&apos;re looking for doesn&apos;t exist or has been moved.
          </p>
        </div>

        <Link
          href="/dashboard"
          className="inline-block btn-primary text-black font-semibold py-3 px-8 rounded-xl text-sm transition-all active:scale-[0.98]"
        >
          Back to Dashboard
        </Link>

        <p className="text-[#525c72] text-xs tracking-wide pt-4">
          &copy; {new Date().getFullYear()} Kilo Energy
        </p>
      </div>
    </div>
  );
}
