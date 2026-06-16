import { CheckoutModeGroup } from './checkout-mode-group';
import {
  InitialConversationField,
  type InitialConversationState,
} from './initial-conversation-section';
import { TaskNameField } from './task-name-field';
import type { FromPullRequestModeState } from './use-from-pull-request-mode';

interface FromPrContentProps {
  state: FromPullRequestModeState;
  disabled?: boolean;
  initialConversation: InitialConversationState;
}

/**
 * Shown when the unified source field has a pull request selected. The PR
 * card lives in the source field; this renders only checkout mode, name,
 * and conversation fields.
 */
export function FromPrContent({ state, disabled, initialConversation }: FromPrContentProps) {
  return (
    <div className="flex flex-col gap-4">
      <CheckoutModeGroup
        value={state.checkoutMode}
        onValueChange={state.setCheckoutMode}
        pushBranch={state.branchSelection.pushBranch}
        onPushBranchChange={state.branchSelection.setPushBranch}
        disabled={disabled}
      />
      <TaskNameField state={state} />
      <InitialConversationField state={initialConversation} />
    </div>
  );
}
