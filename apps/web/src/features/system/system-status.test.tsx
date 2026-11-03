import type { DependencyHealth, HealthReport } from '@arksen/shared-types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SystemStatus } from './system-status';

const up: DependencyHealth = { status: 'up', critical: false, latencyMs: 4 };
const criticalUp: DependencyHealth = { ...up, critical: true };

function report(overrides: Partial<HealthReport> & Partial<HealthReport['dependencies']> = {}) {
  const { status = 'ok', ...dependencies } = overrides;
  return {
    status,
    version: '0.1.0',
    checkedAt: '2026-11-02T10:00:00.000Z',
    dependencies: {
      database: criticalUp,
      redis: criticalUp,
      analytics: up,
      workers: up,
      ...dependencies,
    },
  };
}

function stubApi(health: { status: number; body: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith('/health')
        ? new Response(JSON.stringify(health.body), { status: health.status })
        : new Response(
            JSON.stringify({ name: 'ARKSEN', version: '0.1.0', deploymentMode: 'on-premise' }),
          ),
    ),
  );
}

function renderStatus() {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <SystemStatus />
    </QueryClientProvider>,
  );
}

describe('SystemStatus', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('affiche les quatre services et le mode de déploiement', async () => {
    stubApi({ status: 200, body: report() });
    renderStatus();

    expect(await screen.findByText('Plateforme opérationnelle.')).toBeInTheDocument();
    for (const name of ['PostgreSQL', 'Redis', 'Analytics', 'Workers']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    expect(await screen.findByText('On-Premise')).toBeInTheDocument();
  });

  it('signale un fonctionnement dégradé et indique le service concerné', async () => {
    stubApi({
      status: 200,
      body: report({
        status: 'degraded',
        workers: {
          status: 'down',
          critical: false,
          latencyMs: null,
          message: 'aucun heartbeat récent',
        },
      }),
    });
    renderStatus();

    expect(await screen.findByText('Fonctionnement dégradé.')).toBeInTheDocument();
    const row = screen.getByText('Workers').closest('tr')!;
    expect(within(row).getByText('Indisponible')).toBeInTheDocument();
    expect(within(row).getByText('aucun heartbeat récent')).toBeInTheDocument();
  });

  it('exploite le rapport d’un 503 au lieu de le traiter comme une panne de l’API', async () => {
    stubApi({
      status: 503,
      body: report({
        status: 'error',
        database: {
          status: 'down',
          critical: true,
          latencyMs: null,
          message: 'service injoignable',
        },
      }),
    });
    renderStatus();

    expect(await screen.findByText('Plateforme hors service.')).toBeInTheDocument();
    expect(screen.getByText('service injoignable')).toBeInTheDocument();
  });

  it('dit que l’état est inconnu quand l’API ne répond pas', async () => {
    stubApi({ status: 502, body: { error: 'API injoignable' } });
    renderStatus();

    expect(await screen.findByRole('alert')).toHaveTextContent('L’API ne répond pas');
    expect(screen.queryByText('Disponible')).not.toBeInTheDocument();
  });
});
