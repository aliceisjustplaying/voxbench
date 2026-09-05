import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
  preload: false,
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  preload: false,
});

const description =
  'Record a take and read 10 speech-to-text transcripts side by side. Free trial, bring your own keys, or log in with OpenRouter.';
export const viewport: Viewport = { themeColor: '#1d6b45' };
export const metadata: Metadata = {
  metadataBase: new URL('https://voxbench.app'),
  title: 'Voxbench — which speech-to-text model hears you best?',
  description,
  openGraph: {
    type: 'website',
    url: '/',
    siteName: 'Voxbench',
    title: 'Which speech-to-text model hears you best?',
    description,
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'Voxbench: which speech-to-text model hears you best? Ten models. Free trial, bring your own keys, or log in with OpenRouter.',
      },
    ],
  },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
  manifest: '/manifest.webmanifest',
  twitter: {
    card: 'summary_large_image',
    site: '@aliceisplaying',
    creator: '@aliceisplaying',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
