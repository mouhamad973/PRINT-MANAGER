import type {
  AgentEnrollmentCode,
  AgentSyncLog,
  CollectorAgent,
  DiscoveredDevice,
  Page,
  PrinterSnmpState,
  RejectedAgentEvent,
} from '@arksen/shared-types';
import type { AgentCreateInput, DiscoveredDeviceUpdateInput } from '@arksen/validation';
import { send } from '@/features/fleet/api';
import { apiFetch, queryString } from '@/lib/api';

/** Sous la clé du parc : une modification du parc rafraîchit aussi la collecte. */
export const collectorKeys = {
  all: (tenantId: string) => ['fleet', tenantId, 'collector'] as const,
  agents: (tenantId: string) => ['fleet', tenantId, 'collector', 'agents'] as const,
  syncLogs: (tenantId: string, params: object = {}) =>
    ['fleet', tenantId, 'collector', 'sync-logs', params] as const,
  rejected: (tenantId: string, params: object = {}) =>
    ['fleet', tenantId, 'collector', 'rejected', params] as const,
  devices: (tenantId: string, params: object = {}) =>
    ['fleet', tenantId, 'collector', 'devices', params] as const,
  state: (tenantId: string, printerId: string) =>
    ['fleet', tenantId, 'collector', 'state', printerId] as const,
};

type Params = Record<string, string | number | undefined>;

export const collectorApi = {
  agents: (tenantId: string) => apiFetch<CollectorAgent[]>(`/tenants/${tenantId}/agents`),
  createAgent: (tenantId: string, input: AgentCreateInput) =>
    send<AgentEnrollmentCode>('POST', `/tenants/${tenantId}/agents`, input),
  renewCode: (tenantId: string, agentId: string) =>
    send<AgentEnrollmentCode>('POST', `/tenants/${tenantId}/agents/${agentId}/enrollment-code`),
  revoke: (tenantId: string, agentId: string) =>
    send<CollectorAgent>('POST', `/tenants/${tenantId}/agents/${agentId}/revoke`),
  syncLogs: (tenantId: string, params: Params = {}) =>
    apiFetch<Page<AgentSyncLog>>(`/tenants/${tenantId}/agents/sync-logs${queryString(params)}`),
  rejected: (tenantId: string, params: Params = {}) =>
    apiFetch<Page<RejectedAgentEvent>>(
      `/tenants/${tenantId}/agents/rejected-events${queryString(params)}`,
    ),
  devices: (tenantId: string, params: Params = {}) =>
    apiFetch<Page<DiscoveredDevice>>(
      `/tenants/${tenantId}/discovered-devices${queryString(params)}`,
    ),
  updateDevice: (tenantId: string, deviceId: string, input: DiscoveredDeviceUpdateInput) =>
    send<DiscoveredDevice>('PATCH', `/tenants/${tenantId}/discovered-devices/${deviceId}`, input),
  state: (tenantId: string, printerId: string) =>
    apiFetch<{ state: PrinterSnmpState | null }>(
      `/tenants/${tenantId}/printers/${printerId}/snmp-state`,
    ),
};
