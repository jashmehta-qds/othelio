import type { Metadata } from 'next';
import { AdminProviders } from '../providers/AdminProviders';
import './globals.css';

export const metadata: Metadata = {
  title: 'Othelio Operator Console — Risk Split Administration',
  description: 'Operator console for launching and managing Risk Split markets on Base.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full bg-[#10110f] text-[#eeeee7]">
      <body className="min-h-full flex flex-col font-sans">
        <AdminProviders>{children}</AdminProviders>
      </body>
    </html>
  );
}
