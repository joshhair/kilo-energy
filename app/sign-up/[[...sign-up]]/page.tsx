import { SignUp } from '@clerk/nextjs';

// Sign-up page — mirrors the sign-in page wrapper so the brand experience
// is consistent for invited users completing their first sign-up via
// Clerk's emailed invite link. Same gradient + grid + glow orbs + brand
// wordmark as app/sign-in/[[...sign-in]]/page.tsx; only the Clerk
// component differs (SignUp instead of SignIn) and the tagline is
// welcoming rather than declarative.
export default function SignUpPage() {
  const year = new Date().getFullYear();

  return (
    <div
      data-force-dark
      className="min-h-screen flex flex-col items-center justify-center px-1 sm:px-5 relative overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, #050d18 0%, #0a1628 50%, #0d2040 100%)',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1.5rem)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.5rem)',
      }}
    >
      {/* Background grid */}
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

      {/* Top-left emerald breathing orb */}
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

      {/* Bottom-right cyan breathing orb */}
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

      {/* Main content stack */}
      <div className="relative flex flex-col items-center gap-8 z-10 w-full max-w-md">
        {/* Brand wordmark */}
        <div className="flex flex-col items-center gap-3">
          <div className="inline-flex items-baseline gap-1.5">
            <span
              className="text-[var(--text-primary)] font-black tracking-tight leading-none"
              style={{
                fontSize: 'clamp(2.75rem, 9vw, 4rem)',
                letterSpacing: '-0.05em',
              }}
            >
              kilo
            </span>
            <span
              className="text-[var(--text-primary)] font-light tracking-[0.32em] uppercase"
              style={{ fontSize: 'clamp(0.85rem, 2.4vw, 1rem)' }}
            >
              ENERGY
            </span>
          </div>

          <div
            className="h-px w-32"
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, rgba(0,229,160,0.6) 50%, transparent 100%)',
            }}
          />

          <p
            className="text-center text-sm md:text-base"
            style={{ color: '#8891a8', fontFamily: "'DM Sans', sans-serif" }}
          >
            Welcome to the team. Set up your account.
          </p>
        </div>

        {/* Clerk sign-up card. Outer ring + inner glass each add 4px of
            padding on desktop; on phones every pixel matters because the
            Clerk input placeholders ("Enter your email address" / "Enter
            your phone number") get clipped if the widget is narrower than
            ~290px. Responsive padding (p-0.5 phones, p-1 sm+) gives the
            widget back ~12px on narrow viewports without losing the glass
            frame on desktop. Mirrors the sign-in page treatment. */}
        <div
          className="w-fit max-w-full mx-auto rounded-3xl p-0.5 sm:p-1"
          style={{
            background:
              'linear-gradient(135deg, rgba(0,229,160,0.18) 0%, var(--accent-cyan-soft) 50%, color-mix(in srgb, var(--text-primary) 4%, transparent) 100%)',
            boxShadow:
              '0 0 60px var(--accent-emerald-soft), 0 20px 50px -20px rgba(0,0,0,0.6)',
          }}
        >
          <div
            className="rounded-[22px] p-0 sm:p-1"
            style={{ background: 'rgba(13,21,37,0.75)', backdropFilter: 'blur(10px)' }}
          >
            <SignUp />
          </div>
        </div>

        {/* Footer line */}
        <div className="flex flex-col items-center gap-1 mt-2 text-center">
          <p className="text-[10px] sm:text-xs uppercase whitespace-nowrap" style={{ color: '#525c72', letterSpacing: '0.04em' }}>
            Track commission · pipeline · payouts
          </p>
          <p className="text-[10px] sm:text-[11px]" style={{ color: '#3a4358' }}>
            © {year} Kilo Energy · <a href="/legal/privacy" className="hover:text-[var(--text-primary)]/70 transition-colors">Privacy</a> · <a href="/legal/terms" className="hover:text-[var(--text-primary)]/70 transition-colors">Terms</a>
          </p>
        </div>
      </div>
    </div>
  );
}
