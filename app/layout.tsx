import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppProvider } from '../lib/context';
import { ToastProvider } from '../lib/toast';

export const metadata: Metadata = {
  title: 'Kilo Energy',
  description: 'Solar sales commission tracking',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#060E1E',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full text-white antialiased" style={{ backgroundColor: 'var(--navy-base)' }}>
        <AppProvider>
          <ToastProvider>
            {children}
          </ToastProvider>
        </AppProvider>
      </body>
    </html>
  );
}
