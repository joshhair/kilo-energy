import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

// iOS home-screen icon. 180×180. Same brand as app/icon.tsx but with
// room for a more layered composition: the K wordmark sits on a navy →
// emerald gradient with a sun-disc accent in the top-right corner and
// a soft inner glow in the bottom-left.
//
// Renders entirely from CSS — no external assets, no fonts, no images.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 180,
          height: 180,
          borderRadius: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          overflow: 'hidden',
          // Layered background:
          //   1. base diagonal navy → emerald gradient
          //   2. radial highlight from upper-left for depth
          background:
            'radial-gradient(circle at 25% 20%, rgba(0,229,160,0.4), transparent 55%), linear-gradient(135deg, #050d18 0%, #0a2540 40%, #008f5a 100%)',
          // Faint inner ring suggests a card/lens edge
          boxShadow:
            'inset 0 0 0 2px rgba(0,229,160,0.45), inset 0 -30px 60px rgba(0,40,80,0.4)',
        }}
      >
        {/* Sun-disc accent — top-right corner, evokes solar without being literal */}
        <div
          style={{
            position: 'absolute',
            top: -20,
            right: -20,
            width: 90,
            height: 90,
            borderRadius: '50%',
            background:
              'radial-gradient(circle, rgba(0,255,180,0.55) 0%, rgba(0,229,160,0.18) 35%, transparent 70%)',
            display: 'flex',
          }}
        />

        {/* Bottom-left ambient glow for asymmetry */}
        <div
          style={{
            position: 'absolute',
            bottom: -30,
            left: -25,
            width: 100,
            height: 100,
            borderRadius: '50%',
            background:
              'radial-gradient(circle, rgba(0,180,216,0.45) 0%, transparent 65%)',
            display: 'flex',
          }}
        />

        {/* The K — primary mark, sits above all the glow layers */}
        <span
          style={{
            color: 'white',
            fontSize: 110,
            fontWeight: 900,
            fontFamily: 'system-ui, sans-serif',
            letterSpacing: -5,
            textShadow:
              '0 2px 12px rgba(0,229,160,0.5), 0 1px 3px rgba(0,0,0,0.6)',
            display: 'flex',
            lineHeight: 1,
            zIndex: 1,
          }}
        >
          K
        </span>
      </div>
    ),
    { ...size },
  );
}
