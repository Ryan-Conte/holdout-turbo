import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'HOLDOUT',
  description: 'Top-down survival extraction shooter',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
