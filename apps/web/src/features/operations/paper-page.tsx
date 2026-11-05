'use client';

import {
  PAPER_FORMATS,
  STOCK_MOVEMENT_LABELS,
  type PaperStock,
  type PaperType,
} from '@arksen/shared-types';
import {
  paperStockCreateSchema,
  paperTypeCreateSchema,
  paperTypeUpdateSchema,
  stockMovementCreateSchema,
  stockUpdateSchema,
} from '@arksen/validation';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, PackagePlus, Pencil, Plus, ScrollText, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { fleetApi, fleetKeys } from '@/features/fleet/api';
import { ChooseTenant } from '@/features/fleet/choose-tenant';
import { TenantPicker, useTenantScope } from '@/features/fleet/tenant-scope';
import { numberFormat } from '@/features/meters/meters-ui';
import { useSession } from '@/features/session/session-provider';
import { FormDialog, firstIssue } from '@/features/stocks/stock-dialogs';
import { StockLevelBadge, decimal } from '@/features/stocks/stocks-ui';
import { formatDate, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { opsApi, opsKeys } from './api';
import { money, pageCost } from './ops-ui';

function TypeDialog({
  tenantId,
  type,
  onClose,
}: {
  tenantId: string;
  type: PaperType | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({
    name: type?.name ?? '',
    format: type?.format ?? 'A4',
    grammage: type?.grammage?.toString() ?? '80',
    sheetsPerReam: String(type?.sheetsPerReam ?? 500),
    reamPrice: type?.reamPrice?.toString() ?? '',
    notes: type?.notes ?? '',
  });
  const set = (key: string) => (value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={type ? `Papier ${type.name}` : 'Nouveau papier'}
      submitLabel={type ? 'Enregistrer' : 'Créer le papier'}
      onSubmit={async () => {
        const parsed = (type ? paperTypeUpdateSchema : paperTypeCreateSchema).safeParse(values);
        if (!parsed.success) return firstIssue(parsed.error);
        if (type) await opsApi.updatePaperType(tenantId, type.id, parsed.data);
        else await opsApi.createPaperType(tenantId, parsed.data as never);
        await queryClient.invalidateQueries({ queryKey: opsKeys.all(tenantId) });
        return null;
      }}
    >
      <Field id="paper-name" label="Nom">
        <Input
          id="paper-name"
          placeholder="A4 80 g standard"
          value={values.name}
          onChange={(e) => set('name')(e.target.value)}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="paper-format" label="Format">
          <Select
            id="paper-format"
            value={values.format}
            onChange={(e) => set('format')(e.target.value)}
          >
            {PAPER_FORMATS.map((format) => (
              <option key={format} value={format}>
                {format}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="paper-grammage" label="Grammage" hint="g/m²">
          <Input
            id="paper-grammage"
            inputMode="numeric"
            value={values.grammage}
            onChange={(e) => set('grammage')(e.target.value)}
          />
        </Field>
        <Field id="paper-sheets" label="Feuilles par rame">
          <Input
            id="paper-sheets"
            inputMode="numeric"
            value={values.sheetsPerReam}
            onChange={(e) => set('sheetsPerReam')(e.target.value)}
          />
        </Field>
        <Field id="paper-price" label="Prix de la rame" hint="Donne le coût du papier par page">
          <Input
            id="paper-price"
            inputMode="decimal"
            value={values.reamPrice}
            onChange={(e) => set('reamPrice')(e.target.value)}
          />
        </Field>
      </div>
    </FormDialog>
  );
}

function StockDialog({
  tenantId,
  types,
  onClose,
}: {
  tenantId: string;
  types: PaperType[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState({
    siteId: '',
    paperTypeId: '',
    minQuantity: '5',
    leadTimeDays: '7',
  });
  const sites = useQuery({
    queryKey: fleetKeys.sites(tenantId, { all: true }),
    queryFn: () => fleetApi.allSites(tenantId),
  });
  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Suivre un papier sur un site"
      submitLabel="Créer le stock"
      onSubmit={async () => {
        const parsed = paperStockCreateSchema.safeParse(values);
        if (!parsed.success) return firstIssue(parsed.error);
        await opsApi.createPaperStock(tenantId, parsed.data);
        await queryClient.invalidateQueries({ queryKey: opsKeys.all(tenantId) });
        return null;
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="paper-stock-site" label="Site">
          <Select
            id="paper-stock-site"
            value={values.siteId}
            onChange={(e) => setValues({ ...values, siteId: e.target.value })}
          >
            <option value="">Choisir…</option>
            {sites.data?.items.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="paper-stock-type" label="Papier">
          <Select
            id="paper-stock-type"
            value={values.paperTypeId}
            onChange={(e) => setValues({ ...values, paperTypeId: e.target.value })}
          >
            <option value="">Choisir…</option>
            {types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="paper-stock-min" label="Seuil minimum" hint="Rames">
          <Input
            id="paper-stock-min"
            inputMode="numeric"
            value={values.minQuantity}
            onChange={(e) => setValues({ ...values, minQuantity: e.target.value })}
          />
        </Field>
        <Field id="paper-stock-lead" label="Délai de réapprovisionnement" hint="Jours">
          <Input
            id="paper-stock-lead"
            inputMode="numeric"
            value={values.leadTimeDays}
            onChange={(e) => setValues({ ...values, leadTimeDays: e.target.value })}
          />
        </Field>
      </div>
    </FormDialog>
  );
}

function MovementDialog({
  tenantId,
  stock,
  onClose,
}: {
  tenantId: string;
  stock: PaperStock;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({
    type: 'RECEIPT',
    quantity: '',
    unitCost: '',
    reference: '',
    notes: '',
  });
  const set = (key: string) => (value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`${stock.paperType.name} à ${stock.site.name}`}
      description={`${stock.quantity} rame(s) en stock.`}
      submitLabel="Enregistrer le mouvement"
      onSubmit={async () => {
        const input =
          values.type === 'ADJUSTMENT'
            ? { type: 'ADJUSTMENT', countedQuantity: values.quantity, notes: values.notes }
            : { ...values };
        const parsed = stockMovementCreateSchema.safeParse(input);
        if (!parsed.success) return firstIssue(parsed.error);
        await opsApi.createPaperMovement(tenantId, stock.id, parsed.data);
        await queryClient.invalidateQueries({ queryKey: opsKeys.all(tenantId) });
        return null;
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="paper-move-type" label="Mouvement">
          <Select
            id="paper-move-type"
            value={values.type}
            onChange={(e) => set('type')(e.target.value)}
          >
            <option value="RECEIPT">Réception</option>
            <option value="ISSUE">Sortie</option>
            <option value="ADJUSTMENT">Inventaire</option>
          </Select>
        </Field>
        <Field
          id="paper-move-quantity"
          label={values.type === 'ADJUSTMENT' ? 'Rames comptées' : 'Rames'}
        >
          <Input
            id="paper-move-quantity"
            inputMode="numeric"
            value={values.quantity}
            onChange={(e) => set('quantity')(e.target.value)}
          />
        </Field>
        {values.type === 'RECEIPT' && (
          <Field
            id="paper-move-cost"
            label="Prix de la rame"
            hint={`Facultatif, en ${stock.currency}`}
          >
            <Input
              id="paper-move-cost"
              inputMode="decimal"
              value={values.unitCost}
              onChange={(e) => set('unitCost')(e.target.value)}
            />
          </Field>
        )}
        {values.type !== 'ADJUSTMENT' && (
          <Field id="paper-move-ref" label="Bon" hint="Facultatif">
            <Input
              id="paper-move-ref"
              value={values.reference}
              onChange={(e) => set('reference')(e.target.value)}
            />
          </Field>
        )}
      </div>
    </FormDialog>
  );
}

function ThresholdDialog({
  tenantId,
  stock,
  onClose,
}: {
  tenantId: string;
  stock: PaperStock;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState({
    minQuantity: String(stock.minQuantity),
    leadTimeDays: String(stock.leadTimeDays),
  });
  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Seuils de ${stock.paperType.name} à ${stock.site.name}`}
      submitLabel="Enregistrer"
      onSubmit={async () => {
        const parsed = stockUpdateSchema.safeParse(values);
        if (!parsed.success) return firstIssue(parsed.error);
        await opsApi.updatePaperStock(tenantId, stock.id, parsed.data);
        await queryClient.invalidateQueries({ queryKey: opsKeys.all(tenantId) });
        return null;
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="paper-threshold-min" label="Seuil minimum" hint="Rames">
          <Input
            id="paper-threshold-min"
            inputMode="numeric"
            value={values.minQuantity}
            onChange={(e) => setValues({ ...values, minQuantity: e.target.value })}
          />
        </Field>
        <Field id="paper-threshold-lead" label="Délai de réapprovisionnement" hint="Jours">
          <Input
            id="paper-threshold-lead"
            inputMode="numeric"
            value={values.leadTimeDays}
            onChange={(e) => setValues({ ...values, leadTimeDays: e.target.value })}
          />
        </Field>
      </div>
    </FormDialog>
  );
}

function Movements({ tenantId, stock }: { tenantId: string; stock: PaperStock }) {
  const [page, setPage] = useState(1);
  const movements = useQuery({
    queryKey: opsKeys.key(tenantId, 'paper-movements', { id: stock.id, page }),
    queryFn: () => opsApi.paperMovements(tenantId, stock.id, { page, pageSize: 10 }),
    placeholderData: keepPreviousData,
  });
  return (
    <Panel>
      <PanelHeader title={`Registre de ${stock.paperType.name} à ${stock.site.name}`} />
      {movements.data?.total === 0 && (
        <p className="px-5 pb-6 text-[13px] text-muted-foreground">Aucun mouvement.</p>
      )}
      {movements.data && movements.data.total > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Mouvement</TableHead>
                <TableHead className="text-right">Rames</TableHead>
                <TableHead className="text-right">Solde</TableHead>
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
                    {movement.reference && (
                      <p className="text-xs text-muted-foreground">{movement.reference}</p>
                    )}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'text-right font-medium tabular-nums',
                      movement.quantity > 0 && 'text-success',
                    )}
                  >
                    {movement.quantity > 0 ? `+${movement.quantity}` : movement.quantity}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{movement.balanceAfter}</TableCell>
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

function PaperView({ tenantId }: { tenantId: string }) {
  const { can } = useSession();
  const manage = can('stocks:manage');
  const [editingType, setEditingType] = useState<{ type: PaperType | null } | null>(null);
  const [creatingStock, setCreatingStock] = useState(false);
  const [moving, setMoving] = useState<PaperStock | null>(null);
  const [tuning, setTuning] = useState<PaperStock | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const types = useQuery({
    queryKey: opsKeys.key(tenantId, 'paper-types'),
    queryFn: () => opsApi.paperTypes(tenantId),
  });
  const stocks = useQuery({
    queryKey: opsKeys.key(tenantId, 'paper-stocks'),
    queryFn: () => opsApi.paperStocks(tenantId, { pageSize: 100 }),
  });
  const selectedStock = stocks.data?.items.find((stock) => stock.id === selected) ?? null;

  return (
    <>
      <Panel>
        <PanelHeader
          title="Papiers"
          description="Le prix de la rame donne le coût du papier de chaque page imprimée."
          actions={
            manage && (
              <Button onClick={() => setEditingType({ type: null })}>
                <Plus aria-hidden="true" />
                Nouveau papier
              </Button>
            )
          }
        />
        {types.isPending && <Skeleton className="mx-5 mb-5 h-24" />}
        {types.data?.length === 0 && (
          <EmptyState
            icon={ScrollText}
            title="Aucun papier"
            description="Décrivez les papiers achetés : format, grammage, feuilles par rame et prix."
          />
        )}
        {types.data && types.data.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Papier</TableHead>
                <TableHead className="hidden sm:table-cell">Rame</TableHead>
                <TableHead className="text-right">Prix de la feuille</TableHead>
                <TableHead className="hidden text-right md:table-cell">Machines</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                {manage && <TableHead className="w-0" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {types.data.map((type) => (
                <TableRow key={type.id}>
                  <TableCell>
                    <p className="font-medium">{type.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {type.format}
                      {type.grammage && ` · ${type.grammage} g/m²`}
                    </p>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {numberFormat.format(type.sheetsPerReam)} feuilles ·{' '}
                    {money(type.reamPrice, type.currency)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {pageCost(type.sheetPrice, type.currency)}
                  </TableCell>
                  <TableCell className="hidden text-right md:table-cell">{type.printers}</TableCell>
                  <TableCell className="text-right font-medium">{type.stock} rame(s)</TableCell>
                  {manage && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Modifier ${type.name}`}
                        onClick={() => setEditingType({ type })}
                      >
                        <Pencil aria-hidden="true" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      <Panel>
        <PanelHeader
          title="Stocks de papier"
          description="En rames, par site. La couverture suit les pages des machines réglées sur ce papier (Coûts d’impression)."
          actions={
            manage &&
            Boolean(types.data?.length) && (
              <Button variant="secondary" onClick={() => setCreatingStock(true)}>
                <PackagePlus aria-hidden="true" />
                Suivre un papier
              </Button>
            )
          }
        />
        {stocks.data?.total === 0 && (
          <p className="px-5 pb-6 text-[13px] text-muted-foreground">
            Aucun stock de papier suivi.
          </p>
        )}
        {stocks.data && stocks.data.total > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Papier</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead>Niveau</TableHead>
                <TableHead className="hidden lg:table-cell">Couverture</TableHead>
                <TableHead className="hidden text-right md:table-cell">À commander</TableHead>
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
                    <p className="font-medium">{stock.paperType.name}</p>
                    <p className="text-xs text-muted-foreground">{stock.site.name}</p>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className="font-semibold">{stock.quantity}</span>
                    <p className="text-xs text-muted-foreground">seuil {stock.minQuantity}</p>
                  </TableCell>
                  <TableCell>
                    <StockLevelBadge level={stock.level} />
                  </TableCell>
                  <TableCell className="hidden text-[13px] lg:table-cell">
                    {stock.forecast.daysOfCover === null ? (
                      <span className="text-muted-foreground">Pas de consommation observée</span>
                    ) : (
                      <>
                        {decimal.format(stock.forecast.daysOfCover)} jours
                        <p className="text-xs text-muted-foreground">
                          {decimal.format(stock.forecast.reamsPerDay ?? 0)} rame(s) par jour ·
                          rupture vers le {formatDate(stock.forecast.stockoutAt!)}
                        </p>
                      </>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    {stock.forecast.recommendedOrder || '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Registre"
                        onClick={() => setSelected(selected === stock.id ? null : stock.id)}
                      >
                        <History aria-hidden="true" />
                      </Button>
                      {manage && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Mouvement"
                            onClick={() => setMoving(stock)}
                          >
                            <PackagePlus aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Seuils"
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
        )}
      </Panel>
      {selectedStock && (
        <Movements key={selectedStock.id} tenantId={tenantId} stock={selectedStock} />
      )}
      {editingType && (
        <TypeDialog
          tenantId={tenantId}
          type={editingType.type}
          onClose={() => setEditingType(null)}
        />
      )}
      {creatingStock && (
        <StockDialog
          tenantId={tenantId}
          types={types.data ?? []}
          onClose={() => setCreatingStock(false)}
        />
      )}
      {moving && (
        <MovementDialog tenantId={tenantId} stock={moving} onClose={() => setMoving(null)} />
      )}
      {tuning && (
        <ThresholdDialog tenantId={tenantId} stock={tuning} onClose={() => setTuning(null)} />
      )}
    </>
  );
}

export function PaperPage() {
  const { tenantId, tenantName } = useTenantScope();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Papier"
        description={
          tenantName
            ? `Papiers et stocks de papier de ${tenantName}.`
            : 'Papiers et stocks de papier.'
        }
        actions={<TenantPicker />}
      />
      {tenantId ? <PaperView key={tenantId} tenantId={tenantId} /> : <ChooseTenant />}
    </div>
  );
}
