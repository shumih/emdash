import { createRPCController } from '@shared/ipc/rpc';
import { createConversation } from './createConversation';
import { deleteConversation } from './deleteConversation';
import { forkConversation } from './forkConversation';
import { getConversations } from './getConversations';
import { getConversationsForTask } from './getConversationsForTask';
import { renameConversation } from './renameConversation';

export const conversationController = createRPCController({
  getConversations,
  createConversation,
  deleteConversation,
  forkConversation,
  renameConversation,
  getConversationsForTask,
});
