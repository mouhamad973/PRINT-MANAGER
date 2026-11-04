'use client';

import type { Page, Tenant } from '@arksen/shared-types';
import { useQuery } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Select } from '@/components/ui/select';
import { useSession } from '@/features/session/session-provider';
import { apiFetch } from '@/lib/api';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TenantScope {
  /** Entreprise dont on affiche le parc, ou `null` tant que la plateforme n'en a pas choisi. */
  tenantId: string | null;
  tenantName: string | null;
  /** Compte de plateforme : il choisit l'entreprise dans l'URL (`?tenant=`). */
  isPlatform: boolean;
  /** Ajoute l'entreprise choisie à un lien interne, pour la conserver d'une page à l'autre. */
  href: (path: string) => string;
}

/**
 * Entreprise de travail des pages du parc. Un utilisateur d'entreprise n'a que la sienne ;
 * la plateforme la choisit. Dans les deux cas, l'API revérifie le périmètre à chaque appel.
 */
export function useTenantScope(): TenantScope {
  const { current } = useSession();
  const searchParams = useSearchParams();
  const isPlatform = current.tenant === null;
  const requested = searchParams.get('tenant');
  const tenantId = isPlatform
    ? requested && UUID_PATTERN.test(requested)
      ? requested
      : null
    : current.tenant!.id;

  const tenants = useTenantOptions(isPlatform);
  const tenantName = isPlatform
    ? (tenants.data?.items.find((tenant) => tenant.id === tenantId)?.name ?? null)
    : current.tenant!.name;

  return {
    tenantId,
    tenantName,
    isPlatform,
    href: (path) => {
      if (!isPlatform || !tenantId) return path;
      return `${path}${path.includes('?') ? '&' : '?'}tenant=${tenantId}`;
    },
  };
}

function useTenantOptions(enabled: boolean) {
  return useQuery({
    queryKey: ['tenants', 'options'],
    queryFn: () => apiFetch<Page<Tenant>>('/tenants?pageSize=100'),
    enabled,
    staleTime: 60_000,
  });
}

/** Choix de l'entreprise, réservé à la plateforme. */
export function TenantPicker() {
  const { isPlatform, tenantId } = useTenantScope();
  const tenants = useTenantOptions(isPlatform);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (!isPlatform) return null;

  return (
    <div className="flex items-center gap-2.5">
      <Building2 className="hidden size-[18px] text-muted-foreground sm:block" aria-hidden="true" />
      <div className="w-full sm:w-64">
        <Select
          aria-label="Entreprise"
          value={tenantId ?? ''}
          disabled={tenants.isPending}
          onChange={(event) => {
            const params = new URLSearchParams(searchParams.toString());
            if (event.target.value) params.set('tenant', event.target.value);
            else params.delete('tenant');
            const query = params.toString();
            router.replace(query ? `${pathname}?${query}` : pathname);
          }}
        >
          <option value="">Choisir une entreprise…</option>
          {tenants.data?.items.map((tenant) => (
            <option key={tenant.id} value={tenant.id}>
              {tenant.name}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
