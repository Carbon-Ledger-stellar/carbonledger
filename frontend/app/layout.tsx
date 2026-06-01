import './globals.css';
import type { Metadata } from 'next';
import { ThemeProvider } from '../lib/theme-context';

export const metadata: Metadata = {
  title: 'Carbon Ledger',
  description: 'Carbon credit marketplace and tracking platform',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=yes',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=yes" />
      </head>
       <body>
         <a href="#main-content" className="skip-link">Skip to main content</a>
         <ThemeProvider>
           <main id="main-content">
             {children}
           </main>
         </ThemeProvider>
       </body>
    </html>
  );
} 