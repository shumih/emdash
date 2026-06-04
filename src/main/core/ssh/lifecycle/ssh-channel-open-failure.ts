type ChannelOpenErrorLike = {
  message?: unknown;
  reason?: unknown;
};

// Only SSH_OPEN_ADMINISTRATIVELY_PROHIBITED (1) and SSH_OPEN_RESOURCE_SHORTAGE (4)
// indicate the server-side session limit was hit. Reason 2 (CONNECT_FAILED) and 3
// (UNKNOWN_CHANNEL_TYPE) describe unrelated channel-open errors and used to flip
// the UI into the MaxSessions panel for transient issues that resolved on their
// own — leaving the panel stuck.
const SSH_CHANNEL_OPEN_FAILURE_REASONS = new Set([1, 4]);

export function isSshChannelOpenFailure(error: unknown): boolean {
  const candidate = error as ChannelOpenErrorLike | undefined;
  const message =
    typeof candidate?.message === 'string'
      ? candidate.message
      : error instanceof Error
        ? error.message
        : String(error);
  const reason =
    typeof candidate?.reason === 'number' && SSH_CHANNEL_OPEN_FAILURE_REASONS.has(candidate.reason)
      ? candidate.reason
      : undefined;
  const lower = message.toLowerCase();

  if (
    reason !== undefined ||
    lower.includes('no more sessions') ||
    lower.includes('administratively prohibited')
  ) {
    return true;
  }

  return false;
}
