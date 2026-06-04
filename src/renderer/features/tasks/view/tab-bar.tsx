import { useHotkey } from '@tanstack/react-hotkeys';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { shareCurrentSession } from '@renderer/features/shared-sessions/share-action';
import { useTabGroupContext } from '@renderer/features/tasks/tabs/tab-group-context';
import {
  useConversations,
  useTaskViewContext,
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
import {
  getEffectiveHotkey,
  getHotkeyRegistration,
} from '@renderer/lib/hooks/useKeyboardShortcuts';
import { useTabShortcuts } from '@renderer/lib/hooks/useTabShortcuts';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { isForkableProvider } from '@shared/conversations';
import type { ConversationManagerStore } from '../conversations/conversation-manager';
import type {
  ResolvedConversationTab,
  ResolvedDiffTab,
  ResolvedFileTab,
  ResolvedTab,
} from '../tabs/tab-manager-store';
import { ConversationTabItem } from './tab-bar/conversation-tab-item';
import { DiffTabItem } from './tab-bar/diff-tab-item';
import { PaneDropZone } from './tab-bar/draggable-tab';
import { FileTabItem } from './tab-bar/file-tab-item';
import { TabBarActions } from './tab-bar/tab-bar-actions';

function makeTabRenderers(
  tabManager: ReturnType<typeof useTabGroupContext>['tabManager'],
  conversations: ConversationManagerStore,
  forkAndOpen: (conversationId: string) => void,
  share: (conversationId: string) => void
) {
  return {
    conversation: (tab: ResolvedConversationTab): ReactNode => (
      <ConversationTabItem
        key={tab.tabId}
        tab={tab}
        onSelect={() => tabManager.setActiveTab(tab.tabId)}
        onPin={() => tabManager.openConversation(tab.conversationId)}
        onClose={() => tabManager.closeTabWithGuard(tab.tabId)}
        onRenameSubmit={(name) => void conversations.renameConversation(tab.conversationId, name)}
        onFork={() => forkAndOpen(tab.conversationId)}
        onShare={() => share(tab.conversationId)}
      />
    ),
    diff: (tab: ResolvedDiffTab): ReactNode => (
      <DiffTabItem
        key={tab.tabId}
        tab={tab}
        onSelect={() => tabManager.setActiveTab(tab.tabId)}
        onPin={() => tabManager.pinTab(tab.tabId)}
        onClose={() => tabManager.closeTab(tab.tabId)}
      />
    ),
    file: (tab: ResolvedFileTab): ReactNode => (
      <FileTabItem
        key={tab.tabId}
        tab={tab}
        onSelect={() => tabManager.setActiveTab(tab.tabId)}
        onPin={() => tabManager.pinTab(tab.tabId)}
        onClose={() => tabManager.closeTabWithGuard(tab.tabId)}
      />
    ),
  } satisfies { [K in ResolvedTab['kind']]: (tab: Extract<ResolvedTab, { kind: K }>) => ReactNode };
}

export const TabBar = observer(function TabBar() {
  const taskView = useWorkspaceViewModel();
  const { groupId, tabManager } = useTabGroupContext();
  const { tabGroupManager } = taskView;
  const conversations = useConversations();
  const { taskId } = useTaskViewContext();
  const showForkModal = useShowModal('forkConversationModal');
  const { value: keyboard } = useAppSettingsKey('keyboard');

  const openForkModal = useCallback(
    (conversationId: string) => {
      const source = conversations.conversations.get(conversationId);
      if (!source) return;
      showForkModal({
        taskId,
        conversationId,
        defaultTitle: source.data.title,
        provider: source.data.providerId,
        onSuccess: ({ conversationId: forkedId }) => tabManager.openConversation(forkedId),
      });
    },
    [conversations, tabManager, taskId, showForkModal]
  );

  const shareSessionInPlace = useCallback(
    (conversationId: string) => {
      const source = conversations.conversations.get(conversationId);
      if (!source) return;
      void shareCurrentSession({
        projectId: source.data.projectId,
        taskId,
        conversationId,
        title: source.data.title,
      });
    },
    [conversations, taskId]
  );

  const tabRenderers = makeTabRenderers(
    tabManager,
    conversations,
    openForkModal,
    shareSessionInPlace
  );

  const isFocusedPane =
    taskView.focusedRegion === 'main' && tabGroupManager.activeGroupId === groupId;

  useTabShortcuts(tabManager, { focused: isFocusedPane });

  useHotkey(
    getHotkeyRegistration('forkConversation', keyboard),
    (e) => {
      e.preventDefault();
      const active = tabManager.resolvedTabs.find((t) => t.isActive);
      if (active?.kind === 'conversation' && isForkableProvider(active.store.data.providerId)) {
        openForkModal(active.conversationId);
      }
    },
    {
      enabled: isFocusedPane && getEffectiveHotkey('forkConversation', keyboard) !== null,
      conflictBehavior: 'allow',
    }
  );

  const resolvedTabs = tabManager.resolvedTabs;

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = tabManager.activeTabId;
    if (!id || !scrollContainerRef.current) return;
    const el = scrollContainerRef.current.querySelector<HTMLElement>(
      `[data-tabid="${CSS.escape(id)}"]`
    );
    el?.scrollIntoView({ behavior: 'instant', inline: 'nearest', block: 'nearest' });
  }, [tabManager.activeTabId]);

  return (
    <div className="task-tab-bar flex h-[41px] shrink-0 items-center justify-between border-b border-border bg-background-secondary">
      <div ref={scrollContainerRef} className="flex h-full w-full overflow-x-auto">
        {resolvedTabs.map((tab) => tabRenderers[tab.kind](tab as never))}
        <PaneDropZone groupId={groupId} />
      </div>
      <TabBarActions />
    </div>
  );
});
