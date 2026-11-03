import '@fontsource-variable/archivo';
import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';

export const metadata: Metadata = {
  title: { default: 'ARKSEN Print Manager', template: '%s · ARKSEN Print Manager' },
  description: 'Gestion et supervision des parcs d’impression numérique.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // next-themes écrit la classe du thème avant l'hydratation.
    <html lang="fr" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
