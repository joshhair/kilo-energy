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
  viewportFit: 'cover',
  themeColor: '#0b0d11',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider appearance={{ baseTheme: dark }}>
      <html lang="en" className="h-full">
        <body className="min-h-full text-white antialiased" style={{ backgroundColor: 'var(--navy-base)' }}>
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
