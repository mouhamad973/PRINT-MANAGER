'use client';

import { Building2 } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel } from '@/components/ui/panel';

/** Compte de plateforme sans entreprise choisie : le parc est toujours celui d'une entreprise. */
export function ChooseTenant() {
  return (
    <Panel>
      <EmptyState
        icon={Building2}
        title="Choisissez une entreprise"
        description="Votre compte de plateforme n’appartient à aucune entreprise. Sélectionnez celle dont vous voulez consulter le parc, en haut de la page."
      />
    </Panel>
  );
}
