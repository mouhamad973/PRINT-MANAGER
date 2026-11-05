import type {
  Assignee,
  Contract,
  CostReport,
  Intervention,
  Invoice,
  MaintenancePlan,
  Page,
  PaperMovement,
  PaperStock,
  PaperType,
  PrintedJob,
  PrinterCostSettings,
} from '@arksen/shared-types';
import type {
  ContractCreateInput,
  ContractUpdateInput,
  InterventionCreateInput,
  InterventionUpdateInput,
  InvoiceCreateInput,
  MaintenancePlanCreateInput,
  MaintenancePlanUpdateInput,
  PaperStockCreateInput,
  PaperTypeCreateInput,
  PrinterCostSettingsInput,
  PrintJobPrintedInput,
  StockMovementCreateInput,
  StockTransferInput,
  StockUpdateInput,
} from '@arksen/validation';
import { send } from '@/features/fleet/api';
import { apiFetch, queryString } from '@/lib/api';

/** Sous la clé du parc : les coûts suivent les compteurs, le papier et les interventions. */
export const opsKeys = {
  all: (tenantId: string) => ['fleet', tenantId, 'ops'] as const,
  key: (tenantId: string, name: string, params: object = {}) =>
    ['fleet', tenantId, 'ops', name, params] as const,
};

type Params = Record<string, string | number | undefined>;
const base = (tenantId: string) => `/tenants/${tenantId}`;

export const opsApi = {
  // Papier
  paperTypes: (t: string) => apiFetch<PaperType[]>(`${base(t)}/paper-types`),
  createPaperType: (t: string, input: PaperTypeCreateInput) =>
    send<PaperType>('POST', `${base(t)}/paper-types`, input),
  updatePaperType: (t: string, id: string, input: Partial<PaperTypeCreateInput>) =>
    send<PaperType>('PATCH', `${base(t)}/paper-types/${id}`, input),
  paperStocks: (t: string, params: Params = {}) =>
    apiFetch<Page<PaperStock>>(`${base(t)}/paper-stocks${queryString(params)}`),
  createPaperStock: (t: string, input: PaperStockCreateInput) =>
    send<PaperStock>('POST', `${base(t)}/paper-stocks`, input),
  updatePaperStock: (t: string, id: string, input: StockUpdateInput) =>
    send<PaperStock>('PATCH', `${base(t)}/paper-stocks/${id}`, input),
  paperMovements: (t: string, id: string, params: Params = {}) =>
    apiFetch<Page<PaperMovement>>(`${base(t)}/paper-stocks/${id}/movements${queryString(params)}`),
  createPaperMovement: (t: string, id: string, input: StockMovementCreateInput) =>
    send<PaperStock>('POST', `${base(t)}/paper-stocks/${id}/movements`, input),
  transferPaper: (t: string, input: StockTransferInput) =>
    send<{ from: PaperStock; to: PaperStock }>('POST', `${base(t)}/paper-stocks/transfers`, input),

  // Coûts
  costs: (t: string, params: Params) =>
    apiFetch<CostReport>(`${base(t)}/costs${queryString(params)}`),
  costSettings: (t: string, printerId: string) =>
    apiFetch<PrinterCostSettings>(`${base(t)}/printers/${printerId}/cost-settings`),
  saveCostSettings: (t: string, printerId: string, input: PrinterCostSettingsInput) =>
    send<PrinterCostSettings>('PUT', `${base(t)}/printers/${printerId}/cost-settings`, input),

  // Contrats
  contracts: (t: string, params: Params = {}) =>
    apiFetch<Page<Contract>>(`${base(t)}/contracts${queryString(params)}`),
  createContract: (t: string, input: ContractCreateInput) =>
    send<Contract>('POST', `${base(t)}/contracts`, input),
  updateContract: (t: string, id: string, input: ContractUpdateInput) =>
    send<Contract>('PATCH', `${base(t)}/contracts/${id}`, input),
  setContractPrinters: (t: string, id: string, printerIds: string[]) =>
    send<Contract>('PUT', `${base(t)}/contracts/${id}/printers`, { printerIds }),
  invoices: (t: string, params: Params = {}) =>
    apiFetch<Page<Invoice>>(`${base(t)}/invoices${queryString(params)}`),
  createInvoice: (t: string, contractId: string, input: InvoiceCreateInput) =>
    send<Invoice>('POST', `${base(t)}/contracts/${contractId}/invoices`, input),
  issueInvoice: (t: string, id: string) => send<Invoice>('POST', `${base(t)}/invoices/${id}/issue`),
  cancelInvoice: (t: string, id: string) => send<void>('DELETE', `${base(t)}/invoices/${id}`),

  // Interventions et maintenance
  interventions: (t: string, params: Params = {}) =>
    apiFetch<Page<Intervention>>(`${base(t)}/interventions${queryString(params)}`),
  assignees: (t: string) => apiFetch<Assignee[]>(`${base(t)}/interventions/assignees`),
  createIntervention: (t: string, input: Partial<InterventionCreateInput>) =>
    send<Intervention>('POST', `${base(t)}/interventions`, input),
  updateIntervention: (t: string, id: string, input: InterventionUpdateInput) =>
    send<Intervention>('PATCH', `${base(t)}/interventions/${id}`, input),
  plans: (t: string, params: Params = {}) =>
    apiFetch<MaintenancePlan[]>(`${base(t)}/maintenance-plans${queryString(params)}`),
  createPlan: (t: string, input: MaintenancePlanCreateInput) =>
    send<MaintenancePlan>('POST', `${base(t)}/maintenance-plans`, input),
  updatePlan: (t: string, id: string, input: MaintenancePlanUpdateInput) =>
    send<MaintenancePlan>('PATCH', `${base(t)}/maintenance-plans/${id}`, input),

  // Impressions
  printed: (t: string, params: Params = {}) =>
    apiFetch<Page<PrintedJob>>(`${base(t)}/print-jobs/printed${queryString(params)}`),
  markPrinted: (t: string, jobId: string, input: PrintJobPrintedInput) =>
    send<PrintedJob>('POST', `${base(t)}/print-jobs/${jobId}/printed`, input),
  unmarkPrinted: (t: string, jobId: string) =>
    send<void>('DELETE', `${base(t)}/print-jobs/${jobId}/printed`),
};
