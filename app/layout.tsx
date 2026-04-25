import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppProvider } from '../lib/context';
import { ToastProvider } from '../lib/toast';
import { ClerkProvider } from '@clerk/nextjs';
import { dark } from '@clerk/themes';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';

export const metadata: Metadata = {
  title: 'Kilo Energy',
  description: 'Solar sales commission tracking',
  manifest: '/manifest.json',
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/icon-192.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Kilo Energy',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#0b0d11',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider appearance={{
      baseTheme: dark,
      variables: {
        colorPrimary: '#00e5a0',
        colorTextOnPrimaryBackground: 'var(--surface-page)',
      },
      elements: {
        formButtonPrimary:
          'bg-gradient-to-r from-[#1de9b6] to-[#00b894] text-[var(--surface-page)] font-semibold hover:opacity-90 transition-opacity',
      },
    }}>
      <html lang="en" className="h-full">
        {/* NOTE: deliberately NOT using Tailwind's `antialiased` class here.
             That utility applies -webkit-font-smoothing:antialiased which
             is Mac-retina-optimized and renders lighter/fuzzier text on
             Windows 1080p displays (Josh flagged blur twice). Default
             subpixel rendering is the right call; the globals.css note at
             line 124 has the longer explanation. */}
        <body className="min-h-full text-white" style={{ backgroundColor: 'var(--surface-page)' }}>
          <AppProvider>
            <ToastProvider>
              {children}
            </ToastProvider>
          </AppProvider>
          <Analytics />
          <SpeedInsights />
        </body>
      </html>
    </ClerkProvider>
  );
}
