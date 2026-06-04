import { useState } from 'react';
import { type ShareProviderId } from '@shared/shared-sessions';
import { type FromBranchModeState } from './use-from-branch-mode';

export type FromSharedLinkModeState = ReturnType<typeof useFromSharedLinkMode>;

/**
 * Extra state for the "From Shared Link" create-task tab: the share link/ref
 * and the target provider to import into. Branch picker + task name come from
 * the same `useFromBranchMode` instance the From Branch tab uses, so switching
 * between the two tabs preserves the user's branch/name choices and we don't
 * fire a second `generateTaskName` RPC per modal mount.
 */
export function useFromSharedLinkMode(fromBranch: FromBranchModeState) {
  const [shareLink, setShareLink] = useState('');
  const [targetProvider, setTargetProvider] = useState<ShareProviderId>('claude');

  const isValid = fromBranch.isValid && shareLink.trim().length > 0;

  return { ...fromBranch, shareLink, setShareLink, targetProvider, setTargetProvider, isValid };
}
