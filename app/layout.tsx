import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';

export const metadata: Metadata = {
  title: 'ESG Platform',
  description: 'ESG reporting and analytics platform',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const nonce = headers().get('x-csp-nonce') ?? undefined;

  return (
    <html lang="en">
      <head>
        {nonce ? (
          <script
            nonce={nonce}
            dangerouslySetInnerHTML={{
              __html: `window.__CSP_NONCE__ = ${JSON.stringify(nonce)};`,
            }}
          />
        ) : null}
      </head>
      <body>{children}</body>
    </html>
  );
}
