/** Chat stream hook — wraps chatStore for streaming convenience. */

import { useChatStore } from '../store/chatStore';

export function useChatStream() {
  const {
    messages,
    isStreaming,
    streamContent,
    sendMessage,
    newConversation,
    activeConversationId,
  } = useChatStore();

  return {
    messages,
    isStreaming,
    streamContent,
    sendMessage,
    newConversation,
    activeConversationId,
  };
}
