import { SignIn } from '@clerk/nextjs';

// Sign-in page — branded landing surface for Kilo Energy.
// The Clerk <SignIn /> component handles the actual auth form. Everything
// around it is brand wrapper: ambient gradient + grid background, breathing
// glow orbs in opposite corners, the kilo / ENERGY wordmark, and a tagline.
// All decorative elements use existing CSS animations from globals.css
// (glowBreathe). No new dependencies, no client-side state — pure server
// component.
export default function SignInPage() {
  const year = new Date().getFullYear();

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-5 py-10 relative overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, #050d18 0%, #0a1628 50%, #0d2040 100%)',
      }}
    >
      {/* ── Background grid — extremely faint, anchors the layout in space ── */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse at center, black 40%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse at center, black 40%, transparent 75%)',
        }}
      />

      {/* ── Top-left emerald breathing orb ── */}
      <div
        aria-hidden="true"
        className="absolute pointer-events-none hero-glow-orb"
        style={{
          top: '-15%',
          left: '-10%',
          width: '60vmin',
          height: '60vmin',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0,229,160,0.32) 0%, transparent 65%)',
          filter: 'blur(20px)',
        }}
      />

      {/* ── Bottom-right cyan breathing orb (opposite phase via animationDelay) ── */}
      <div
        aria-hidden="true"
        className="absolute pointer-events-none hero-glow-orb"
        style={{
          bottom: '-20%',
          right: '-15%',
          width: '70vmin',
          height: '70vmin',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0,180,216,0.28) 0%, transparent 65%)',
          filter: 'blur(20px)',
          animationDelay: '-2.5s',
        }}
      />

      {/* ── Main content stack ── */}
      <div className="relative flex flex-col items-center gap-8 z-10 w-full max-w-md">
        {/* Brand wordmark — matches the 404 page + dashboard greeting style */}
        <div className="flex flex-col items-center gap-3">
          <div className="inline-flex items-baseline gap-1.5">
            <span
              className="text-white font-black tracking-tight leading-none"
              style={{
                fontSize: 'clamp(2.75rem, 9vw, 4rem)',
                letterSpacing: '-0.05em',
              }}
            >
              kilo
            </span>
            <span
              className="text-white font-light tracking-[0.32em] uppercase"
              style={{ fontSize: 'clamp(0.85rem, 2.4vw, 1rem)' }}
            >
              ENERGY
            </span>
          </div>

          {/* Subtle gradient underline accent */}
          <div
            className="h-px w-32"
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, rgba(0,229,160,0.6) 50%, transparent 100%)',
            }}
          />

          {/* Tagline */}
          <p
            className="text-center text-sm md:text-base"
            style={{ color: '#8891a8', fontFamily: "'DM Sans', sans-serif" }}
          >
            Solar sales, run on real numbers.
          </p>
        </div>

        {/* Clerk sign-in card — sits inside a subtle glass frame */}
        <div
          className="w-full rounded-3xl p-1"
          style={{
            background:
              'linear-gradient(135deg, rgba(0,229,160,0.18) 0%, rgba(0,180,216,0.10) 50%, rgba(255,255,255,0.04) 100%)',
            boxShadow:
              '0 0 60px rgba(0,229,160,0.10), 0 20px 50px -20px rgba(0,0,0,0.6)',
          }}
        >
          <div
            className="rounded-[22px] p-1"
            style={{ background: 'rgba(13,21,37,0.75)', backdropFilter: 'blur(10px)' }}
          >
            <SignIn />
          </div>
        </div>

        {/* Footer line */}
        <div className="flex flex-col items-center gap-1 mt-2">
          <p className="text-xs tracking-wider uppercase" style={{ color: '#525c72', letterSpacing: '0.08em' }}>
            Track commission · pipeline · payouts
          </p>
          <p className="text-[11px]" style={{ color: '#3a4358' }}>
            © {year} Kilo Energy · <a href="/legal/privacy" className="hover:text-white/70 transition-colors">Privacy</a> · <a href="/legal/terms" className="hover:text-white/70 transition-colors">Terms</a>
          </p>
        </div>
      </div>
    </div>
  );
}
