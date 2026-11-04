import type {
  PrintJob,
  PrintJobEstimate,
  PrintJobSummary,
  ConsumptionSimulation,
  FleetConsumption,
  PrinterConsumptionDetail,
  TonerSpec,
  FleetDashboard,
  FleetMeterAnomaly,
  FleetVolumes,
  MeterReading,
  PrinterVolumes,
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
  readings: (tenantId: string, printerId: string, params: object = {}) =>
    ['fleet', tenantId, 'readings', printerId, params] as const,
  volumes: (tenantId: string, params: object = {}) =>
    ['fleet', tenantId, 'volumes', params] as const,
  anomalies: (tenantId: string, params: object = {}) =>
    ['fleet', tenantId, 'anomalies', params] as const,
  consumption: (tenantId: string, params: object = {}) =>
    ['fleet', tenantId, 'consumption', params] as const,
  toners: (tenantId: string | null, modelId: string) =>
    ['fleet', tenantId ?? 'catalog', 'toners', modelId] as const,
  jobs: (tenantId: string, params: object = {}) => ['fleet', tenantId, 'jobs', params] as const,
  job: (tenantId: string, jobId: string) => ['fleet', tenantId, 'job', jobId] as const,
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
  readings: (tenantId: string, printerId: string, params: Params = {}) =>
    apiFetch<Page<MeterReading>>(
      `/tenants/${tenantId}/printers/${printerId}/meter-readings${queryString(params)}`,
    ),
  printerVolumes: (tenantId: string, printerId: string, params: Params) =>
    apiFetch<PrinterVolumes>(
      `/tenants/${tenantId}/printers/${printerId}/volumes${queryString(params)}`,
    ),
  volumes: (tenantId: string, params: Params) =>
    apiFetch<FleetVolumes>(`/tenants/${tenantId}/volumes${queryString(params)}`),
  anomalies: (tenantId: string, params: Params = {}) =>
    apiFetch<FleetMeterAnomaly[]>(`/tenants/${tenantId}/meter-anomalies${queryString(params)}`),
  consumption: (tenantId: string, params: Params) =>
    apiFetch<FleetConsumption>(`/tenants/${tenantId}/consumption${queryString(params)}`),
  printerConsumption: (tenantId: string, printerId: string, params: Params) =>
    apiFetch<PrinterConsumptionDetail>(
      `/tenants/${tenantId}/printers/${printerId}/consumption${queryString(params)}`,
    ),
  /** Toners d'une fiche : vue de l'entreprise (avec ses prix), ou catalogue si `tenantId` est nul. */
  toners: (tenantId: string | null, modelId: string) =>
    apiFetch<TonerSpec[]>(
      `${tenantId ? `/tenants/${tenantId}` : ''}/printer-models/${modelId}/toners`,
    ),
  jobs: (tenantId: string, params: Params = {}) =>
    apiFetch<Page<PrintJobSummary>>(`/tenants/${tenantId}/print-jobs${queryString(params)}`),
  job: (tenantId: string, jobId: string) =>
    apiFetch<PrintJob>(`/tenants/${tenantId}/print-jobs/${jobId}`),
  jobEstimate: (tenantId: string, jobId: string, params: Params) =>
    apiFetch<PrintJobEstimate>(
      `/tenants/${tenantId}/print-jobs/${jobId}/estimate${queryString(params)}`,
    ),
  simulate: (tenantId: string, body: unknown) =>
    apiFetch<ConsumptionSimulation>(`/tenants/${tenantId}/consumption/simulate`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

export function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
