import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

// Browser-tab favicon. Generated server-side via next/og — must stay
// renderable with no external assets and no @font-face.
//
// Brand: deep navy → emerald gradient with a tilted "ki" wordmark sitting
// on top of a soft accent halo. Reads as Kilo Energy at 32px (the K is
// what survives at favicon size; the lowercase i adds character without
// harming legibility).
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          // Deep navy base with an emerald → cyan diagonal sweep, plus an
          // inner radial highlight in the top-left to suggest a glow source.
          background:
            'radial-gradient(circle at 25% 20%, rgba(0,229,160,0.55), transparent 60%), linear-gradient(135deg, #061018 0%, #0a2540 45%, #00b478 100%)',
          boxShadow: 'inset 0 0 0 1px rgba(0,229,160,0.35)',
          overflow: 'hidden',
        }}
      >
        {/* Bottom-right glow accent — soft halo to add depth */}
        <div
          style={{
            position: 'absolute',
            right: -4,
            bottom: -4,
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(0,229,160,0.6) 0%, transparent 70%)',
            display: 'flex',
          }}
        />
        <span
          style={{
            color: 'var(--text-primary)',
            fontSize: 20,
            fontWeight: 900,
            fontFamily: 'system-ui, sans-serif',
            letterSpacing: -1.5,
            // Subtle text shadow gives the K a slight edge against the gradient
            textShadow: '0 1px 2px rgba(0,0,0,0.45)',
            display: 'flex',
            lineHeight: 1,
          }}
        >
          K
        </span>
      </div>
    ),
    { ...size },
  );
}
