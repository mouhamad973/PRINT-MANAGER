import { Prisma, withTenant, type PrismaClient } from '@arksen/database';
import {
  CONNECTIVITY_STATUSES,
  PRINTER_STATUSES,
  type ConnectivityStatus,
  type FleetDashboard,
  type PrinterStatus,
} from '@arksen/shared-types';
import type { FleetDashboardQuery } from '@arksen/validation';
import { Inject, Injectable } from '@nestjs/common';
import { PRISMA_APP } from '../database/database.module.js';

const ATTENTION_LIMIT = 8;
const SITE_LIMIT = 12;

function zeroes<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
}

/**
 * Tableau de bord du parc. Il ne contient que des comptages : la connectivité reste « non mesurée »
 * tant que l'agent de collecte (Phase 7) ne l'a pas relevée, et rien n'est extrapolé.
 */
@Injectable()
export class DashboardService {
  constructor(@Inject(PRISMA_APP) private readonly appPrisma: PrismaClient) {}

  get(tenantId: string, query: FleetDashboardQuery): Promise<FleetDashboard> {
    return withTenant(this.appPrisma, tenantId, async (tx) => {
      const scope: Prisma.PrinterWhereInput = {
        tenantId,
        ...(query.siteId ? { siteId: query.siteId } : {}),
        ...(query.colorMode ? { model: { colorMode: query.colorMode } } : {}),
      };
      // Le parc actif exclut les machines retirées ; la répartition par statut les montre toutes.
      const active: Prisma.PrinterWhereInput = { ...scope, status: { not: 'RETIRED' } };

      const [
        printers,
        sites,
        color,
        monochrome,
        networkConfigured,
        statusGroups,
        connectivityGroups,
        siteGroups,
        modelGroups,
        attention,
      ] = await Promise.all([
        tx.printer.count({ where: active }),
        tx.site.count({ where: { tenantId, ...(query.siteId ? { id: query.siteId } : {}) } }),
        tx.printer.count({ where: { AND: [active, { model: { colorMode: 'COLOR' } }] } }),
        tx.printer.count({ where: { AND: [active, { model: { colorMode: 'MONOCHROME' } }] } }),
        tx.printer.count({
          where: {
            AND: [
              active,
              {
                connection: { OR: [{ ipAddress: { not: null } }, { hostname: { not: null } }] },
              },
            ],
          },
        }),
        tx.printer.groupBy({ by: ['status'], where: scope, _count: { _all: true } }),
        tx.printer.groupBy({ by: ['connectivity'], where: active, _count: { _all: true } }),
        tx.printer.groupBy({ by: ['siteId'], where: active, _count: { _all: true } }),
        tx.printer.groupBy({ by: ['modelId'], where: active, _count: { _all: true } }),
        tx.printer.findMany({
          where: {
            AND: [
              active,
              {
                OR: [
                  { status: { in: ['OUT_OF_SERVICE', 'MAINTENANCE'] } },
                  { connection: { is: null } },
                ],
              },
            ],
          },
          select: {
            id: true,
            name: true,
            status: true,
            site: { select: { name: true } },
            connection: { select: { ipAddress: true, hostname: true } },
          },
          orderBy: [{ status: 'desc' }, { name: 'asc' }],
          take: ATTENTION_LIMIT,
        }),
      ]);

      const siteNames = new Map(
        (
          await tx.site.findMany({
            where: { id: { in: siteGroups.map((group) => group.siteId) } },
            select: { id: true, name: true },
          })
        ).map((site) => [site.id, site.name]),
      );
      const manufacturers = new Map(
        (
          await tx.printerModel.findMany({
            where: { id: { in: modelGroups.map((group) => group.modelId) } },
            select: { id: true, manufacturer: true },
          })
        ).map((model) => [model.id, model.manufacturer]),
      );
      const byManufacturer = new Map<string, number>();
      for (const group of modelGroups) {
        const name = manufacturers.get(group.modelId) ?? 'Inconnu';
        byManufacturer.set(name, (byManufacturer.get(name) ?? 0) + group._count._all);
      }

      const byStatus = zeroes<PrinterStatus>(PRINTER_STATUSES);
      for (const group of statusGroups) byStatus[group.status] = group._count._all;
      const byConnectivity = zeroes<ConnectivityStatus>(CONNECTIVITY_STATUSES);
      for (const group of connectivityGroups)
        byConnectivity[group.connectivity] = group._count._all;

      return {
        totals: { printers, sites, color, monochrome, networkConfigured },
        byStatus,
        byConnectivity,
        bySite: siteGroups
          .map((group) => ({
            siteId: group.siteId,
            name: siteNames.get(group.siteId) ?? 'Site inconnu',
            count: group._count._all,
          }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'fr'))
          .slice(0, SITE_LIMIT),
        byManufacturer: [...byManufacturer.entries()]
          .map(([manufacturer, count]) => ({ manufacturer, count }))
          .sort((a, b) => b.count - a.count || a.manufacturer.localeCompare(b.manufacturer, 'fr')),
        attention: attention.map((printer) => ({
          id: printer.id,
          name: printer.name,
          status: printer.status,
          address: printer.connection?.ipAddress ?? printer.connection?.hostname ?? null,
          siteName: printer.site.name,
        })),
      };
    });
  }
}
