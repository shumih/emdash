import { useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@renderer/lib/ipc';
import type { SubscriptionProfile } from '@shared/app-settings';

const QUERY_KEY = ['subscription-profiles'] as const;

/** Subscription (account) profile metadata — names only, tokens stay in main. */
export function useSubscriptionProfiles() {
  const { data, isLoading } = useQuery<SubscriptionProfile[]>({
    queryKey: QUERY_KEY,
    queryFn: () => rpc.subscriptions.list(),
    staleTime: 60_000,
  });
  return { profiles: data ?? [], isLoading };
}

export function useInvalidateSubscriptionProfiles() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  };
}
