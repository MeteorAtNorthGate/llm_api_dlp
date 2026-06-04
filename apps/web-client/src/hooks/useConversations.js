/** Conversations hook — list management from chatStore. */

import { useEffect } from 'react';
import { useChatStore } from '../store/chatStore';

export function useConversations() {
  const {
    conversations,
    loadConversations,
    loadConversation,
    deleteConversation,
    activeConversationId,
  } = useChatStore();

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  return {
    conversations,
    activeConversationId,
    loadConversation,
    deleteConversation,
  };
}
