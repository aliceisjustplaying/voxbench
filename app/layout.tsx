import type { Metadata } from 'next';
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
  'Record a take and read 11 speech-to-text transcripts side by side. Try three free, run all eleven with your own keys.';
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
        alt: 'Voxbench: which speech-to-text model hears you best? Eleven models, three free to try.',
      },
    ],
  },
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
