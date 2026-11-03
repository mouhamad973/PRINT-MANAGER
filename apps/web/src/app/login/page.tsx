import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from '@/features/session/login-form';
import { BrandMark, ControlStrip } from '@/components/layout/brand-mark';

export const metadata: Metadata = { title: 'Connexion' };

export default function LoginPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <ControlStrip />
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex justify-center rounded-lg bg-sidebar px-4 py-5">
            <BrandMark />
          </div>
          <h1 className="text-xl font-semibold">Connexion</h1>
          <p className="mt-1 mb-6 text-muted-foreground">
            Accédez à la supervision de votre parc d’impression.
          </p>
          {/* useSearchParams exige une frontière Suspense pour le rendu statique. */}
          <Suspense>
            <LoginForm />
          </Suspense>
          <p className="mt-8 text-xs text-muted-foreground">
            Pas encore de compte ? Il est créé par l’administrateur de votre entreprise.
          </p>
        </div>
      </main>
    </div>
  );
}
