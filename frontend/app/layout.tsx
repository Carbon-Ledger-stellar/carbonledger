import './globals.css';
import type { Metadata } from 'next';
import { ThemeProvider } from '../lib/theme-context';
import Navbar from '../components/Navbar';
import ServiceWorkerRegistration from '../components/ServiceWorkerRegistration';
import AppProviders from '../components/AppProviders';
import RealtimeNotificationProvider from '../components/RealtimeNotificationProvider';
import LocaleProvider from '../components/LocaleProvider';
import en from '../public/locales/en/common.json';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
  title: 'Carbon Ledger',
  description: 'Carbon credit marketplace and tracking platform',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=yes',
  openGraph: {
    siteName: 'Carbon Ledger',
    type: 'website',
  },
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
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#7C3AED" />
        <link rel="apple-touch-icon" href="/icons/icon-192.svg" />
        <link rel="icon" href="/icons/icon-192.svg" type="image/svg+xml" />
      </head>
       <body>
         <LocaleProvider initialMessages={en}>
           <a href="#main-content" className="skip-link">Skip to main content</a>
           <ServiceWorkerRegistration />
           <ThemeProvider>
                     <AppProviders>
                       <RealtimeNotificationProvider>
                         <Navbar />
                         <main id="main-content">
                           {children}
                         </main>
                       </RealtimeNotificationProvider>
                     </AppProviders>
                   </ThemeProvider>
         </LocaleProvider>
       </body>
    </html>
  );
} 