'use client';

import { STOCK_MOVEMENT_LABELS, type TonerStock } from '@arksen/shared-types';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  History,
  Package,
  PackagePlus,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';
import { useCallback, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FormError } from '@/components/ui/field';
import { Pagination } from '@/components/ui/pagination';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { SearchInput } from '@/components/ui/search-input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { InkLabel } from '@/features/consumption/consumption-ui';
import { fleetApi, fleetKeys } from '@/features/fleet/api';
import { ChooseTenant } from '@/features/fleet/choose-tenant';
import { TenantPicker, useTenantScope } from '@/features/fleet/tenant-scope';
import { numberFormat } from '@/features/meters/meters-ui';
import { useSession } from '@/features/session/session-provider';
import { errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { stockApi, stockKeys } from './api';
import { MovementDialog, NewStockDialog, ThresholdDialog, TransferDialog } from './stock-dialogs';
import { ForecastCell, StockLevelBadge, formatAmount } from './stocks-ui';

const PAGE_SIZE = 25;

function Movements({ tenantId, stock }: { tenantId: string; stock: TonerStock }) {
  const [page, setPage] = useState(1);
  const movements = useQuery({
    queryKey: stockKeys.movements(tenantId, stock.id, { page }),
    queryFn: () => stockApi.movements(tenantId, stock.id, { page, pageSize: 10 }),
    placeholderData: keepPreviousData,
  });
  return (
    <Panel>
      <PanelHeader
        title={`Registre de ${stock.reference} à ${stock.site.name}`}
        description="Chaque entrée et chaque sortie, avec le solde qui en résulte. Le registre ne se modifie pas : une erreur se corrige par un inventaire."
      />
      {movements.isPending && <Skeleton className="mx-5 mb-5 h-24" />}
      {movements.data?.total === 0 && (
        <p className="px-5 pb-6 text-[13px] text-muted-foreground">
          Aucun mouvement pour l’instant.
        </p>
      )}
      {movements.data && movements.data.total > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Mouvement</TableHead>
                <TableHead className="text-right">Quantité</TableHead>
                <TableHead className="text-right">Solde</TableHead>
                <TableHead className="hidden md:table-cell">Détail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.data.items.map((movement) => (
                <TableRow key={movement.id}>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(movement.occurredAt)}
                  </TableCell>
                  <TableCell>
                    {STOCK_MOVEMENT_LABELS[movement.type]}
                    {movement.createdByEmail && (
                      <p className="text-xs text-muted-foreground">{movement.createdByEmail}</p>
                    )}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'text-right font-medium tabular-nums',
                      movement.quantity > 0 ? 'text-success' : 'text-foreground',
                    )}
                  >
                    {movement.quantity > 0 ? `+${movement.quantity}` : movement.quantity}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{movement.balanceAfter}</TableCell>
                  <TableCell className="hidden text-[13px] text-muted-foreground md:table-cell">
                    {[
                      movement.printer && `Machine ${movement.printer.name}`,
                      movement.reference,
                      movement.unitCost !== null && formatAmount(movement.unitCost, stock.currency),
                      movement.notes,
                    ]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            page={page}
            pageSize={10}
            total={movements.data.total}
            onPageChange={setPage}
          />
        </>
      )}
    </Panel>
  );
}

function StocksView({ tenantId }: { tenantId: string }) {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const manage = can('stocks:manage');
  const [search, setSearch] = useState('');
  const [siteId, setSiteId] = useState('');
  const [level, setLevel] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [moving, setMoving] = useState<TonerStock | null>(null);
  const [transferring, setTransferring] = useState<TonerStock | null>(null);
  const [tuning, setTuning] = useState<TonerStock | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const params = { search, siteId: siteId || undefined, level: level || undefined, page };
  const stocks = useQuery({
    queryKey: stockKeys.stocks(tenantId, params),
    queryFn: () => stockApi.stocks(tenantId, { ...params, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  // Indicateurs sur tout le stock, indépendamment des filtres.
  const all = useQuery({
    queryKey: stockKeys.stocks(tenantId, { all: true }),
    queryFn: () => stockApi.stocks(tenantId, { pageSize: 100 }),
  });
  const sites = useQuery({
    queryKey: fleetKeys.sites(tenantId, { all: true }),
    queryFn: () => fleetApi.allSites(tenantId),
  });
  const onSearch = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  const items = all.data?.items ?? [];
  const currency = items[0]?.currency ?? 'XOF';
  const value = items.reduce((sum, stock) => sum + (stock.value ?? 0), 0);
  const selectedStock = stocks.data?.items.find((stock) => stock.id === selected) ?? null;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          featured
          label="Cartouches en stock"
          value={numberFormat.format(items.reduce((sum, stock) => sum + stock.quantity, 0))}
          hint={`${items.length} article(s) suivis`}
        />
        <StatCard
          label="Sous le seuil"
          value={numberFormat.format(items.filter((stock) => stock.level === 'LOW').length)}
          hint="Articles à réapprovisionner"
        />
        <StatCard
          label="En rupture"
          value={numberFormat.format(items.filter((stock) => stock.level === 'OUT').length)}
          hint="Plus aucune cartouche"
        />
        <StatCard
          compact
          label="Valeur du stock"
          value={formatAmount(value, currency)}
          hint="Au dernier coût de réception"
        />
      </div>

      <Panel>
        <PanelHeader
          title="Articles"
          description="Une référence par site. Les prévisions suivent la consommation estimée par le moteur CMJN sur 90 jours."
          actions={
            manage && (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={async () => {
                    setError(null);
                    try {
                      const result = await stockApi.evaluate(tenantId);
                      setNotice(`${result.raised} rupture(s) prévue(s) signalée(s).`);
                      await queryClient.invalidateQueries({ queryKey: stockKeys.all(tenantId) });
                    } catch (caught) {
                      setError(errorMessage(caught));
                    }
                  }}
                >
                  <RefreshCw aria-hidden="true" />
                  Recalculer les alertes
                </Button>
                <Button onClick={() => setCreating(true)}>
                  <PackagePlus aria-hidden="true" />
                  Suivre une référence
                </Button>
              </div>
            )
          }
        />
        <div className="flex flex-wrap gap-3 px-5 pb-4">
          <SearchInput
            label="Rechercher une référence"
            placeholder="Référence"
            onSearch={onSearch}
          />
          <Select
            aria-label="Site"
            className="w-auto min-w-44"
            value={siteId}
            onChange={(event) => {
              setSiteId(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Tous les sites</option>
            {sites.data?.items.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Niveau"
            className="w-auto min-w-44"
            value={level}
            onChange={(event) => {
              setLevel(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Tous les niveaux</option>
            <option value="OUT">En rupture</option>
            <option value="LOW">Sous le seuil</option>
            <option value="OK">Suffisant</option>
          </Select>
        </div>
        {(notice || error) && (
          <div className="px-5 pb-4">
            {error ? (
              <FormError message={error} />
            ) : (
              <p className="text-[13px] text-muted-foreground">{notice}</p>
            )}
          </div>
        )}
        {stocks.isPending && <Skeleton className="mx-5 mb-5 h-40" />}
        {stocks.data?.total === 0 && (
          <EmptyState
            icon={Package}
            title={
              search || siteId || level ? 'Aucun article ne correspond' : 'Aucun toner en stock'
            }
            description={
              search || siteId || level
                ? 'Modifiez les filtres.'
                : 'Suivez une référence de toner sur un site : ses réceptions, ses sorties et ses installations tiendront son stock à jour.'
            }
          />
        )}
        {stocks.data && stocks.data.total > 0 && (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Référence</TableHead>
                  <TableHead className="hidden md:table-cell">Site</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead>Niveau</TableHead>
                  <TableHead className="hidden lg:table-cell">Couverture</TableHead>
                  <TableHead className="hidden text-right xl:table-cell">À commander</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {stocks.data.items.map((stock) => (
                  <TableRow
                    key={stock.id}
                    className={cn(selected === stock.id && 'bg-primary-soft/40')}
                  >
                    <TableCell>
                      <p className="font-medium whitespace-nowrap">{stock.reference}</p>
                      <InkLabel channel={stock.channel} className="text-xs text-muted-foreground" />
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {stock.site.name}
                      <p className="text-xs text-muted-foreground">
                        {stock.printers} machine(s) équipée(s)
                      </p>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className="font-semibold">{stock.quantity}</span>
                      <p className="text-xs text-muted-foreground">seuil {stock.minQuantity}</p>
                    </TableCell>
                    <TableCell>
                      <StockLevelBadge level={stock.level} />
                    </TableCell>
                    <TableCell className="hidden text-[13px] lg:table-cell">
                      <ForecastCell forecast={stock.forecast} />
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums xl:table-cell">
                      {stock.forecast.recommendedOrder > 0 ? (
                        <span className="font-medium">{stock.forecast.recommendedOrder}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                      <p className="text-xs text-muted-foreground">délai {stock.leadTimeDays} j</p>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Registre de ${stock.reference}`}
                          onClick={() => setSelected(selected === stock.id ? null : stock.id)}
                        >
                          <History aria-hidden="true" />
                          <span className="sr-only 2xl:not-sr-only">Registre</span>
                        </Button>
                        {manage && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Mouvement de ${stock.reference}`}
                              onClick={() => setMoving(stock)}
                            >
                              <PackagePlus aria-hidden="true" />
                              <span className="sr-only 2xl:not-sr-only">Mouvement</span>
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Transférer ${stock.reference}`}
                              onClick={() => setTransferring(stock)}
                            >
                              <ArrowLeftRight aria-hidden="true" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Seuils de ${stock.reference}`}
                              onClick={() => setTuning(stock)}
                            >
                              <SlidersHorizontal aria-hidden="true" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={stocks.data.total}
              onPageChange={setPage}
            />
          </>
        )}
      </Panel>

      {selectedStock && (
        <Movements key={selectedStock.id} tenantId={tenantId} stock={selectedStock} />
      )}

      <NewStockDialog tenantId={tenantId} open={creating} onOpenChange={setCreating} />
      <MovementDialog tenantId={tenantId} stock={moving} onClose={() => setMoving(null)} />
      <TransferDialog
        tenantId={tenantId}
        stock={transferring}
        onClose={() => setTransferring(null)}
      />
      <ThresholdDialog tenantId={tenantId} stock={tuning} onClose={() => setTuning(null)} />
    </>
  );
}

export function StocksPage() {
  const { tenantId, tenantName } = useTenantScope();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Stocks"
        description={
          tenantName
            ? `Toners en stock de ${tenantName} : réceptions, sorties, installations, seuils et ruptures prévues.`
            : 'Toners en stock : réceptions, sorties, installations, seuils et ruptures prévues.'
        }
        actions={<TenantPicker />}
      />
      {tenantId ? <StocksView key={tenantId} tenantId={tenantId} /> : <ChooseTenant />}
    </div>
  );
}
