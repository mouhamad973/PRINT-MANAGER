import type {
  FleetDashboard,
  Page,
  PrinterDetail,
  Printer,
  PrinterModel,
  Site,
} from '@arksen/shared-types';
import { apiFetch, queryString } from '@/lib/api';

/** Clés de cache : tout ce qui touche au parc d'une entreprise est invalidé ensemble. */
export const fleetKeys = {
  all: (tenantId: string) => ['fleet', tenantId] as const,
  sites: (tenantId: string, params: object = {}) => ['fleet', tenantId, 'sites', params] as const,
  models: (tenantId: string | null, params: object = {}) =>
    ['fleet', tenantId ?? 'catalog', 'models', params] as const,
  printers: (tenantId: string, params: object = {}) =>
    ['fleet', tenantId, 'printers', params] as const,
  printer: (tenantId: string, printerId: string) =>
    ['fleet', tenantId, 'printer', printerId] as const,
  dashboard: (tenantId: string, params: object = {}) =>
    ['fleet', tenantId, 'dashboard', params] as const,
};

type Params = Record<string, string | number | undefined>;

export const fleetApi = {
  sites: (tenantId: string, params: Params = {}) =>
    apiFetch<Page<Site>>(`/tenants/${tenantId}/sites${queryString(params)}`),
  /** Tous les sites, pour les listes de choix. */
  allSites: (tenantId: string) =>
    apiFetch<Page<Site>>(`/tenants/${tenantId}/sites${queryString({ pageSize: 100 })}`),
  /** Fiches visibles par l'entreprise, ou catalogue Arksen seul si `tenantId` est nul. */
  models: (tenantId: string | null, params: Params = {}) =>
    apiFetch<Page<PrinterModel>>(
      `${tenantId ? `/tenants/${tenantId}` : ''}/printer-models${queryString(params)}`,
    ),
  model: (tenantId: string, modelId: string) =>
    apiFetch<PrinterModel>(`/tenants/${tenantId}/printer-models/${modelId}`),
  printers: (tenantId: string, params: Params = {}) =>
    apiFetch<Page<Printer>>(`/tenants/${tenantId}/printers${queryString(params)}`),
  printer: (tenantId: string, printerId: string) =>
    apiFetch<PrinterDetail>(`/tenants/${tenantId}/printers/${printerId}`),
  dashboard: (tenantId: string, params: Params = {}) =>
    apiFetch<FleetDashboard>(`/tenants/${tenantId}/fleet-dashboard${queryString(params)}`),
};

export function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
