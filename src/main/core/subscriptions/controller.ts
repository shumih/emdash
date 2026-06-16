import { createRPCController } from '@/shared/ipc/rpc';
import type { SubscriptionProfile } from '@shared/app-settings';
import { subscriptionService } from './subscription-service';

/** Tokens flow renderer → main only; list() returns metadata, never tokens. */
export const subscriptionsController = createRPCController({
  list: (): Promise<SubscriptionProfile[]> => subscriptionService.list(),

  create: (name: string, token: string): Promise<SubscriptionProfile> =>
    subscriptionService.create(name, token),

  updateToken: (id: string, token: string): Promise<void> =>
    subscriptionService.updateToken(id, token),

  delete: (id: string): Promise<void> => subscriptionService.delete(id),
});
