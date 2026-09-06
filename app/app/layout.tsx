import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'K-Line | Stock workspace',
  description: 'Receive, price and monitor K-Line stock.',
  manifest: '/manifest.webmanifest',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  /* Apply the workspace theme and document language to every route. */

  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
