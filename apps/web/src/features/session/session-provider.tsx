'use client';

import { hasPermission, type CurrentUser, type Permission } from '@arksen/shared-types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, type ReactNode } from 'react';
import { ApiError, apiFetch, authFetch } from '@/lib/api';

interface SessionValue {
  current: CurrentUser;
  /** Pour l'affichage uniquement : chaque action est revérifiée par l'API. */
  can: (permission: Permission) => boolean;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export const ME_QUERY_KEY = ['me'] as const;

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error('useSession doit être utilisé sous SessionProvider');
  }
  return value;
}

export function SessionProvider({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const me = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: () => apiFetch<CurrentUser>('/me'),
    retry: false,
    staleTime: 60_000,
  });

  const unauthenticated =
    me.error instanceof ApiError && (me.error.status === 401 || me.error.status === 403);

  useEffect(() => {
    if (unauthenticated) {
      const reason = (me.error as ApiError).status === 403 ? '&reason=disabled' : '';
      router.replace(`/login?next=${encodeURIComponent(pathname)}${reason}`);
    }
  }, [unauthenticated, me.error, pathname, router]);

  const signOut = useCallback(async () => {
    await authFetch('/sign-out', {}).catch(() => undefined);
    queryClient.clear();
    router.replace('/login');
  }, [queryClient, router]);

  if (!me.data) {
    return fallback;
  }

  const current = me.data;
  const value: SessionValue = {
    current,
    can: (permission) => hasPermission(current.user.role, permission),
    signOut,
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
