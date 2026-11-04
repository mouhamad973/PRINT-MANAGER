import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from '@/features/session/login-form';
import { BrandMark, ControlStrip } from '@/components/layout/brand-mark';

export const metadata: Metadata = { title: 'Connexion' };

export default function LoginPage() {
  return (
    <div className="flex min-h-dvh gap-3 p-3">
      <aside className="hero-surface relative hidden w-[44%] max-w-xl flex-col justify-between overflow-hidden rounded-2xl p-10 lg:flex">
        <BrandMark inverted />
        {/* Repère de calage agrandi : le motif de la marque, en filigrane. */}
        <svg
          viewBox="0 0 200 200"
          className="pointer-events-none absolute -right-24 -bottom-24 size-[28rem] text-hero-foreground opacity-[0.07]"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          aria-hidden="true"
        >
          <circle cx="100" cy="100" r="46" />
          <circle cx="100" cy="100" r="78" />
          <path d="M100 0v200M0 100h200" />
        </svg>
        <div className="relative max-w-md">
          <p className="text-[2rem] leading-[1.15] font-semibold tracking-[-0.03em] text-balance">
            Supervision du parc d’impression et consommation toner calculée sur l’aplat CMJN.
          </p>
          <ControlStrip className="mt-8 w-40" />
        </div>
      </aside>

      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-10 lg:hidden">
            <BrandMark />
          </div>
          <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.03em]">
            Connexion
          </h1>
          <p className="mt-1.5 mb-8 text-[15px] text-muted-foreground">
            Accédez à la supervision de votre parc d’impression.
          </p>
          {/* useSearchParams exige une frontière Suspense pour le rendu statique. */}
          <Suspense>
            <LoginForm />
          </Suspense>
          <p className="mt-10 text-[13px] text-muted-foreground">
            Pas encore de compte ? Il est créé par l’administrateur de votre entreprise.
          </p>
        </div>
      </main>
    </div>
  );
}
