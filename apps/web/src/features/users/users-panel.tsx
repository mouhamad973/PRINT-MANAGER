'use client';

import { ROLE_LABELS, type Page, type UserAccount } from '@arksen/shared-types';
import type { UserCreateInput, UserUpdateInput } from '@arksen/validation';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Pencil, Plus, Users } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/field';
import { Pagination } from '@/components/ui/pagination';
import { Panel } from '@/components/ui/panel';
import { SearchInput } from '@/components/ui/search-input';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useSession } from '@/features/session/session-provider';
import { apiFetch, queryString } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { CreateUserDialog, EditUserDialog, ResetPasswordDialog } from './user-dialogs';

const PAGE_SIZE = 25;

type Editing = { kind: 'edit' | 'password'; user: UserAccount } | null;

/** Utilisateurs d'une entreprise. `tenantId` vient de la session ou de l'URL, et l'API le revérifie. */
export function UsersPanel({ tenantId }: { tenantId: string }) {
  const { current, can } = useSession();
  const queryClient = useQueryClient();
  const canManage = can('users:manage');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const base = `/tenants/${tenantId}/users`;

  const users = useQuery({
    queryKey: ['users', tenantId, { search, page }],
    queryFn: () =>
      apiFetch<Page<UserAccount>>(`${base}${queryString({ search, page, pageSize: PAGE_SIZE })}`),
    placeholderData: keepPreviousData,
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['users', tenantId] }),
      queryClient.invalidateQueries({ queryKey: ['tenants'] }),
    ]);

  const create = useMutation({
    mutationFn: (values: UserCreateInput) =>
      apiFetch<UserAccount>(base, { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: async (user) => {
      await refresh();
      setCreating(false);
      setNotice(`Compte créé pour ${user.name}. Transmettez-lui son mot de passe provisoire.`);
    },
  });

  const update = useMutation({
    mutationFn: ({ id, values }: { id: string; values: UserUpdateInput }) =>
      apiFetch<UserAccount>(`${base}/${id}`, { method: 'PATCH', body: JSON.stringify(values) }),
    onSuccess: async (user) => {
      await refresh();
      setEditing(null);
      setNotice(`Modifications enregistrées pour ${user.name}.`);
    },
  });

  const resetPassword = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      apiFetch<void>(`${base}/${id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ password }),
      }),
    onSuccess: (_result, { id }) => {
      const user = users.data?.items.find((item) => item.id === id);
      setEditing(null);
      setNotice(
        `Nouveau mot de passe défini${user ? ` pour ${user.name}` : ''}. Ses sessions ont été fermées.`,
      );
    },
  });

  const onSearch = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  return (
    <section className="space-y-3" aria-labelledby="users-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="users-title" className="text-lg font-semibold tracking-[-0.015em]">
          Utilisateurs
        </h2>
        <div className="flex w-full flex-wrap items-center gap-2.5 sm:w-auto sm:flex-nowrap">
          <SearchInput
            label="Rechercher un utilisateur"
            placeholder="Nom ou e-mail"
            onSearch={onSearch}
          />
          {canManage && (
            <Button
              onClick={() => {
                setNotice(null);
                setCreating(true);
              }}
            >
              <Plus aria-hidden="true" />
              Nouvel utilisateur
            </Button>
          )}
        </div>
      </div>

      {notice && (
        <p
          role="status"
          className="rounded-md border border-success/25 bg-success/10 px-3.5 py-2.5 text-[13px] text-success"
        >
          {notice}
        </p>
      )}

      <Panel>
        {users.isPending && (
          <div className="space-y-4 p-5" role="status" aria-label="Chargement des utilisateurs">
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className="h-6" />
            ))}
          </div>
        )}
        {users.isError && <FormError message={users.error.message} />}
        {users.data && users.data.total === 0 && (
          <div className="flex flex-col items-start gap-3 p-6 sm:p-8">
            <Users
              className="size-10 rounded-full bg-primary-soft p-2.5 text-primary-soft-foreground"
              aria-hidden="true"
            />
            <div>
              <p className="font-medium">
                {search ? 'Aucun utilisateur ne correspond' : 'Aucun utilisateur'}
              </p>
              <p className="mt-1 text-muted-foreground">
                {search
                  ? 'Modifiez la recherche.'
                  : 'Commencez par créer l’administrateur de l’entreprise.'}
              </p>
            </div>
          </div>
        )}
        {users.data && users.data.total > 0 && (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Utilisateur</TableHead>
                  <TableHead className="hidden sm:table-cell">Rôle</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="hidden md:table-cell">Créé le</TableHead>
                  {canManage && (
                    <TableHead className="text-right">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.data.items.map((user) => {
                  const isSelf = user.id === current.user.id;
                  return (
                    <TableRow key={user.id}>
                      <TableCell>
                        <p className="font-medium">
                          {user.name}
                          {isSelf && (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              vous
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">{user.email}</p>
                        <p className="text-xs text-muted-foreground sm:hidden">
                          {ROLE_LABELS[user.role]}
                        </p>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {ROLE_LABELS[user.role]}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={user.status} />
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">
                        {formatDate(user.createdAt)}
                      </TableCell>
                      {canManage && (
                        <TableCell className="text-right whitespace-nowrap">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Modifier ${user.name}`}
                            title="Modifier"
                            onClick={() => {
                              setNotice(null);
                              setEditing({ kind: 'edit', user });
                            }}
                          >
                            <Pencil aria-hidden="true" />
                          </Button>
                          {!isSelf && (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Réinitialiser le mot de passe de ${user.name}`}
                              title="Réinitialiser le mot de passe"
                              onClick={() => {
                                setNotice(null);
                                setEditing({ kind: 'password', user });
                              }}
                            >
                              <KeyRound aria-hidden="true" />
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={users.data.total}
              onPageChange={setPage}
            />
          </>
        )}
      </Panel>

      {canManage && (
        <CreateUserDialog
          open={creating}
          onOpenChange={setCreating}
          onSubmit={(values) => create.mutateAsync(values).then(() => undefined)}
        />
      )}
      {editing?.kind === 'edit' && (
        <EditUserDialog
          key={editing.user.id}
          user={editing.user}
          isSelf={editing.user.id === current.user.id}
          onOpenChange={(open) => !open && setEditing(null)}
          onSubmit={(values) =>
            update
              .mutateAsync({ id: editing.user.id, values: values as UserUpdateInput })
              .then(() => undefined)
          }
        />
      )}
      {editing?.kind === 'password' && (
        <ResetPasswordDialog
          key={editing.user.id}
          user={editing.user}
          onOpenChange={(open) => !open && setEditing(null)}
          onSubmit={(password) =>
            resetPassword.mutateAsync({ id: editing.user.id, password }).then(() => undefined)
          }
        />
      )}
    </section>
  );
}
