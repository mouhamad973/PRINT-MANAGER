import type {
  Alert,
  AlertSummary,
  DetectedReplacement,
  Page,
  StockMovement,
  TonerReference,
  TonerReplacement,
  TonerStock,
} from '@arksen/shared-types';
import type {
  StockCreateInput,
  StockMovementCreateInput,
  StockTransferInput,
  StockUpdateInput,
  TonerReplacementCreateInput,
} from '@arksen/validation';
import { send } from '@/features/fleet/api';
import { apiFetch, queryString } from '@/lib/api';

/** Sous la clé du parc : un remplacement ou un mouvement rafraîchit tout ce qui en dépend. */
export const stockKeys = {
  all: (tenantId: string) => ['fleet', tenantId, 'stocks'] as const,
  stocks: (tenantId: string, params: object = {}) =>
    ['fleet', tenantId, 'stocks', 'list', params] as const,
  movements: (tenantId: string, stockId: string, params: object = {}) =>
    ['fleet', tenantId, 'stocks', 'movements', stockId, params] as const,
  references: (tenantId: string) => ['fleet', tenantId, 'stocks', 'references'] as const,
  replacements: (tenantId: string, params: object = {}) =>
    ['fleet', tenantId, 'stocks', 'replacements', params] as const,
  detected: (tenantId: string) => ['fleet', tenantId, 'stocks', 'detected'] as const,
  alerts: (tenantId: string, params: object = {}) =>
    ['fleet', tenantId, 'stocks', 'alerts', params] as const,
  alertSummary: (tenantId: string) => ['fleet', tenantId, 'stocks', 'alert-summary'] as const,
};

type Params = Record<string, string | number | undefined>;
const base = (tenantId: string) => `/tenants/${tenantId}`;

export const stockApi = {
  stocks: (tenantId: string, params: Params = {}) =>
    apiFetch<Page<TonerStock>>(`${base(tenantId)}/stocks${queryString(params)}`),
  createStock: (tenantId: string, input: StockCreateInput) =>
    send<TonerStock>('POST', `${base(tenantId)}/stocks`, input),
  updateStock: (tenantId: string, stockId: string, input: StockUpdateInput) =>
    send<TonerStock>('PATCH', `${base(tenantId)}/stocks/${stockId}`, input),
  movements: (tenantId: string, stockId: string, params: Params = {}) =>
    apiFetch<Page<StockMovement>>(
      `${base(tenantId)}/stocks/${stockId}/movements${queryString(params)}`,
    ),
  createMovement: (tenantId: string, stockId: string, input: StockMovementCreateInput) =>
    send<TonerStock>('POST', `${base(tenantId)}/stocks/${stockId}/movements`, input),
  transfer: (tenantId: string, input: StockTransferInput) =>
    send<{ from: TonerStock; to: TonerStock }>('POST', `${base(tenantId)}/stocks/transfers`, input),
  evaluate: (tenantId: string) =>
    send<{ raised: number }>('POST', `${base(tenantId)}/stocks/evaluate-alerts`),
  references: (tenantId: string) =>
    apiFetch<TonerReference[]>(`${base(tenantId)}/toner-references`),
  replacements: (tenantId: string, params: Params = {}) =>
    apiFetch<Page<TonerReplacement>>(`${base(tenantId)}/toner-replacements${queryString(params)}`),
  detected: (tenantId: string) =>
    apiFetch<DetectedReplacement[]>(`${base(tenantId)}/toner-replacements/detected`),
  replace: (tenantId: string, input: TonerReplacementCreateInput) =>
    send<TonerReplacement>('POST', `${base(tenantId)}/toner-replacements`, input),
  cancelReplacement: (tenantId: string, replacementId: string) =>
    send<void>('DELETE', `${base(tenantId)}/toner-replacements/${replacementId}`),
  alerts: (tenantId: string, params: Params = {}) =>
    apiFetch<Page<Alert>>(`${base(tenantId)}/alerts${queryString(params)}`),
  alertSummary: (tenantId: string) => apiFetch<AlertSummary>(`${base(tenantId)}/alerts/summary`),
  actOnAlert: (tenantId: string, alertId: string, action: 'acknowledge' | 'resolve') =>
    send<Alert>('PATCH', `${base(tenantId)}/alerts/${alertId}`, { action }),
};
